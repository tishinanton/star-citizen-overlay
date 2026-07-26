import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { MiningMaterial } from '../shared/contracts'
import {
  estimateHighQualityProbability,
  loadMiningLocations,
  parseMiningLocationRecommendations
} from './mining-locations'

const COMMODITY_UUID = 'commodity-target'

test('estimates the chance of crossing the high-quality threshold', () => {
  assert.equal(estimateHighQualityProbability(501, 1_000, 500, 150), 1)
  assert.equal(estimateHighQualityProbability(0, 499, 250, 100), 0)
  assert.ok(Math.abs(estimateHighQualityProbability(0, 1_000, 500, 100) - 0.5) < 0.001)
  assert.equal(estimateHighQualityProbability(0, 1_000, null, null), 0.5)
})

test('ranks the top five distinct locations by high-quality probability', () => {
  const result = parseMiningLocationRecommendations(
    {
      data: {
        uuid: COMMODITY_UUID,
        slug: 'target-ore',
        locations: [
          location('Foxtrot', 0.2, 0.2),
          location('Low grade', 1, 1, { qualityMin: 0, qualityMax: 499 }),
          location('Mid grade', 0.5, 0.5, {
            qualityMin: 0,
            qualityMax: 1_000,
            qualityMean: 500,
            qualityStdDev: 100
          }),
          location('Echo', 0.2, 0.4),
          location('Alpha', 0.4, 0.5),
          location('Boosted', 0.1, 0.4, {
            areas: [{ name: 'Coastline', global_modifier: 4 }]
          }),
          location('Delta', 0.2, 0.5)
        ]
      }
    },
    'target-ore'
  )

  assert.deepEqual(
    result.map((entry) => entry.name),
    ['Alpha', 'Mid grade', 'Boosted', 'Delta', 'Echo']
  )
  assert.equal(result.length, 5)
  assert.equal(result[2].area, 'Coastline')
  assert.ok(Math.abs(result[2].highQualityProbability - 0.1) < 0.0001)
  assert.equal(result[0].maxQuality, 1_000)
  assert.equal(result[0].maxComposition, 75)
})

test('rejects mismatched or malformed commodity detail payloads', () => {
  assert.throws(
    () =>
      parseMiningLocationRecommendations(
        { data: { uuid: COMMODITY_UUID, slug: 'another-ore', locations: [] } },
        'target-ore'
      ),
    /another material/
  )
  assert.throws(
    () => parseMiningLocationRecommendations({ data: { slug: 'target-ore' } }, 'target-ore'),
    /unexpected mining location data/
  )
})

test('caches successful recommendations for offline use', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-locations-'))
  const cachePath = join(directory, 'locations.json')
  const originalFetch = globalThis.fetch
  const material: MiningMaterial = {
    id: 'target-ore',
    name: 'Target Ore',
    displayName: 'Target Ore',
    signature: 4_000,
    methods: ['Ship'],
    sourceUrl: 'https://example.com/target-ore'
  }
  const payload = {
    data: {
      uuid: COMMODITY_UUID,
      slug: material.id,
      locations: [location('Cached site', 0.4, 0.5)]
    }
  }

  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    const live = await loadMiningLocations(cachePath, material)
    assert.equal(live.state, 'live')
    assert.equal(live.locations[0].name, 'Cached site')

    globalThis.fetch = async () => {
      throw new Error('offline')
    }
    const cached = await loadMiningLocations(cachePath, material)
    assert.equal(cached.state, 'cached')
    assert.deepEqual(cached.locations, live.locations)
    assert.match(cached.message, /offline/)
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

function location(
  name: string,
  groupProbability: number,
  relativeProbability: number,
  options: {
    qualityMin?: number
    qualityMax?: number
    qualityMean?: number
    qualityStdDev?: number
    areas?: Array<{ name: string; global_modifier: number }>
  } = {}
): Record<string, unknown> {
  const qualityMin = options.qualityMin ?? 501
  const qualityMax = options.qualityMax ?? 1_000

  return {
    uuid: `location-${name.toLocaleLowerCase().replaceAll(' ', '-')}`,
    name,
    display_name: name,
    system: 'Stanton System',
    type: 'Moon',
    parent_name: 'Stanton',
    link: `https://example.com/${name}`,
    areas: options.areas ?? null,
    resources: [
      {
        group_name: 'SpaceShip_Mineables',
        area_exceptions: null,
        materials: [
          {
            uuid: 'another-commodity',
            is_current: false,
            quality_min: 501,
            quality_max: 1_000,
            quality_mean: 500,
            quality_stddev: 150,
            max_percentage: 100,
            group_probability: 1,
            relative_probability: 1
          },
          {
            uuid: COMMODITY_UUID,
            is_current: true,
            quality_min: qualityMin,
            quality_max: qualityMax,
            quality_mean: options.qualityMean ?? qualityMin,
            quality_stddev: options.qualityStdDev ?? 100,
            max_percentage: 75,
            group_probability: groupProbability,
            relative_probability: relativeProbability
          }
        ]
      }
    ]
  }
}
