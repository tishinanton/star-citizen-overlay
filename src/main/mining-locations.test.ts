import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { MiningMaterial } from '../shared/contracts'
import {
  estimateHighQualityProbability,
  loadMiningLocations,
  parseMiningLocationRecommendations,
  resolvePreferredMiningLocation
} from './mining-locations'

const COMMODITY_UUID = 'commodity-target'

test('estimates the chance of crossing the high-quality threshold', () => {
  assert.equal(estimateHighQualityProbability(501, 1_000, 500, 150), 1)
  assert.equal(estimateHighQualityProbability(0, 499, 250, 100), 0)
  assert.ok(Math.abs(estimateHighQualityProbability(0, 1_000, 500, 100) - 0.5) < 0.001)
  assert.equal(estimateHighQualityProbability(0, 1_000, null, null), 0.5)
})

test('ranks every distinct location and retains zero or unavailable probabilities', () => {
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
          location('Delta', 0.2, 0.5),
          location('Unknown chance', null, null)
        ]
      }
    },
    'target-ore'
  )

  assert.deepEqual(
    result.map((entry) => entry.name),
    ['Alpha', 'Mid grade', 'Boosted', 'Delta', 'Echo', 'Foxtrot', 'Low grade', 'Unknown chance']
  )
  assert.equal(result.length, 8)
  assert.equal(result[2].area, 'Coastline')
  const boostedProbability = result[2].combinedProbability
  if (boostedProbability === null) assert.fail('Boosted should have an estimated probability')
  assert.ok(Math.abs(boostedProbability - 0.1) < 0.0001)
  assert.equal(result[0].minQuality, 501)
  assert.equal(result[0].maxQuality, 1_000)
  assert.equal(result[0].maxComposition, 75)
  assert.equal(result[6].combinedProbability, 0)
  assert.equal(result[6].minQuality, 0)
  assert.equal(result[6].maxQuality, 499)
  assert.equal(result[7].combinedProbability, null)
  assert.equal(resolvePreferredMiningLocation(result, 'location-echo')?.name, 'Echo')
  assert.equal(resolvePreferredMiningLocation(result, 'missing-location')?.name, 'Alpha')
  assert.equal(resolvePreferredMiningLocation([], 'location-echo'), null)
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
    commodityId: 'target-ore',
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
    assert.equal(live.locations[0].minQuality, 501)

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

test('keeps active-threshold cache data when an older request finishes last', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-locations-race-'))
  const cachePath = join(directory, 'locations.json')
  const originalFetch = globalThis.fetch
  const material: MiningMaterial = {
    id: 'target-ore',
    commodityId: 'target-ore',
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
  const response = (): Response =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  let releaseFirstFetch: (value: Response) => void = (value) => {
    void value
    throw new Error('The first fetch was not started.')
  }
  let fetchCount = 0

  try {
    globalThis.fetch = async () => {
      fetchCount += 1
      if (fetchCount === 1) {
        return new Promise<Response>((resolve) => {
          releaseFirstFetch = resolve
        })
      }
      return response()
    }

    const olderRequest = loadMiningLocations(cachePath, material, null, null, 500)
    const activeResult = await loadMiningLocations(cachePath, material, null, null, 750)
    releaseFirstFetch(response())
    await olderRequest
    assert.equal(activeResult.qualityThreshold, 750)

    globalThis.fetch = async () => {
      throw new Error('offline')
    }
    const cached = await loadMiningLocations(cachePath, material, null, null, 750)
    assert.equal(cached.state, 'cached')
    assert.equal(cached.qualityThreshold, 750)
    assert.deepEqual(cached.locations, activeResult.locations)
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test('does not let an invalidated same-threshold request replace current cache data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-locations-generation-race-'))
  const cachePath = join(directory, 'locations.json')
  const originalFetch = globalThis.fetch
  const material: MiningMaterial = {
    id: 'target-ore',
    commodityId: 'target-ore',
    name: 'Target Ore',
    displayName: 'Target Ore',
    signature: 4_000,
    methods: ['Ship'],
    sourceUrl: 'https://example.com/target-ore'
  }
  const payload = (name: string): Record<string, unknown> => ({
    data: {
      uuid: COMMODITY_UUID,
      slug: material.id,
      locations: [location(name, 0.4, 0.5)]
    }
  })
  const response = (name: string): Response =>
    new Response(JSON.stringify(payload(name)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  let releaseFirstFetch: (value: Response) => void = (value) => {
    void value
    throw new Error('The first fetch was not started.')
  }
  let fetchCount = 0
  let olderRequestIsCurrent = true

  try {
    globalThis.fetch = async () => {
      fetchCount += 1
      if (fetchCount === 1) {
        return new Promise<Response>((resolve) => {
          releaseFirstFetch = resolve
        })
      }
      return response('Current site')
    }

    const olderRequest = loadMiningLocations(
      cachePath,
      material,
      null,
      null,
      500,
      () => olderRequestIsCurrent
    )
    olderRequestIsCurrent = false
    const currentResult = await loadMiningLocations(cachePath, material, null, null, 500)
    releaseFirstFetch(response('Stale site'))
    await olderRequest
    assert.equal(currentResult.locations[0].name, 'Current site')

    globalThis.fetch = async () => {
      throw new Error('offline')
    }
    const cached = await loadMiningLocations(cachePath, material, null, null, 500)
    assert.equal(cached.state, 'cached')
    assert.equal(cached.locations[0].name, 'Current site')
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test('loads older cached recommendations without a minimum quality value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-locations-legacy-'))
  const cachePath = join(directory, 'locations.json')
  const originalFetch = globalThis.fetch
  const material: MiningMaterial = {
    id: 'target-ore',
    commodityId: 'target-ore',
    name: 'Target Ore',
    displayName: 'Target Ore',
    signature: 4_000,
    methods: ['Ship'],
    sourceUrl: 'https://example.com/target-ore'
  }

  await writeFile(
    cachePath,
    JSON.stringify({
      entries: {
        [material.id]: {
          savedAt: '2026-08-01T10:00:00.000Z',
          locations: [
            {
              id: 'legacy-location',
              name: 'Legacy Site',
              area: null,
              system: 'Stanton System',
              type: 'Moon',
              parentName: 'Stanton',
              highQualityProbability: 0.25,
              maxQuality: 1_000,
              maxComposition: 75,
              sourceUrl: 'https://example.com/legacy-location'
            }
          ]
        }
      }
    })
  )

  try {
    globalThis.fetch = async () => {
      throw new Error('offline')
    }
    const cached = await loadMiningLocations(cachePath, material)
    assert.equal(cached.state, 'cached')
    assert.equal(cached.locations[0].name, 'Legacy Site')
    assert.equal(cached.locations[0].minQuality, null)
    assert.equal(cached.locations[0].rockSpawnProbability, null)
    assert.equal(cached.locations[0].qualityThresholdProbability, null)
    assert.equal(cached.locations[0].combinedProbability, 0.25)

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: {
            uuid: COMMODITY_UUID,
            slug: material.id,
            locations: [location('Current site', 0.4, 0.5)]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    const current = await loadMiningLocations(cachePath, material, null, null, 750)
    assert.equal(current.qualityThreshold, 750)

    globalThis.fetch = async () => {
      throw new Error('offline')
    }
    const migratedLegacy = await loadMiningLocations(cachePath, material, null, null, 500)
    assert.equal(migratedLegacy.state, 'cached')
    assert.equal(migratedLegacy.locations[0].name, 'Legacy Site')
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

function location(
  name: string,
  groupProbability: number | null,
  relativeProbability: number | null,
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
