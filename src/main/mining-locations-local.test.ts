import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { MiningMaterial } from '../shared/contracts'
import { estimateQuantizedThresholdProbability } from './mining-estimator'
import { buildLocalMiningLocations, loadMiningLocations } from './mining-locations'
import type { MiningCatalog, MiningCatalogMaterial, MiningCatalogProvider } from './mining-catalog'

const HADANITE_MATERIAL_ID = '3e5fdc37-cb59-4fd3-8168-e3c538ab9722'
const HADANITE_ENTITY_ID = '3998d58a-4021-4697-9432-2162aff01c73'
const ABERDEEN_ID = 'f8f07f5b-1c0e-47c9-aa50-46963065bf18'
const HURSTON_PROVIDER_ID = '8f6fb27e-e373-4eaa-991b-7c55303f4bbc'
const UNRESOLVED_PROVIDER_ID = '2c5b1a2e-2a34-4b23-9e21-1a2b3c4d5e6f'
const HARVESTABLE_PRESET_ID = 'f42be172-0391-4482-b3ff-6f97c2182272'

const HADANITE_QUALITY = { min: 201, max: 1_000, mean: 201, stdDev: 298 }
const HADANITE_BANDS = [
  { start: 0, end: 399, mappedValue: 274 },
  { start: 400, end: 599, mappedValue: 526 },
  { start: 600, end: 699, mappedValue: 665 },
  { start: 700, end: 799, mappedValue: 762 },
  { start: 800, end: 899, mappedValue: 867 },
  { start: 900, end: 949, mappedValue: 916 },
  { start: 950, end: 998, mappedValue: 959 },
  { start: 999, end: 1_000, mappedValue: 1_000 }
]
const REACHABLE_VALUES = [274, 526, 665, 762, 867, 916, 959, 1_000]

function hadaniteCatalogMaterial(): MiningCatalogMaterial {
  return {
    id: HADANITE_MATERIAL_ID,
    key: 'Hadanite',
    slug: 'hadanite',
    name: 'Hadanite',
    densityGramsPerCubicCentimeter: 2.2,
    instability: 200,
    resistance: 0,
    defaultQuality: HADANITE_QUALITY,
    qualityLocationOverrides: [],
    quantizationBands: HADANITE_BANDS
  }
}

function resolvedProvider(): MiningCatalogProvider {
  return {
    id: HURSTON_PROVIDER_ID,
    key: 'HPP_Stanton1b',
    locationId: ABERDEEN_ID,
    locationName: 'Stanton1b',
    groups: [
      {
        groupName: 'FPS_Mineables',
        groupProbability: 0.25,
        contributions: [
          {
            harvestablePresetId: HARVESTABLE_PRESET_ID,
            entityId: HADANITE_ENTITY_ID,
            relativeProbability: 0.06,
            clusterId: null,
            materials: [
              {
                materialId: HADANITE_MATERIAL_ID,
                effectiveQuality: HADANITE_QUALITY,
                usedLocationOverride: false,
                reachableQuantizedValues: REACHABLE_VALUES
              }
            ]
          }
        ]
      }
    ],
    areas: []
  }
}

function unresolvedProvider(): MiningCatalogProvider {
  return {
    id: UNRESOLVED_PROVIDER_ID,
    key: 'HPP_Stanton2c_Belt',
    locationId: null,
    locationName: null,
    groups: [
      {
        groupName: 'Ship_Mineables',
        groupProbability: 0.5,
        contributions: [
          {
            harvestablePresetId: HARVESTABLE_PRESET_ID,
            entityId: HADANITE_ENTITY_ID,
            relativeProbability: 0.1,
            clusterId: null,
            materials: [
              {
                materialId: HADANITE_MATERIAL_ID,
                effectiveQuality: HADANITE_QUALITY,
                usedLocationOverride: false,
                reachableQuantizedValues: REACHABLE_VALUES
              }
            ]
          }
        ]
      }
    ],
    areas: []
  }
}

const SECOND_UNRESOLVED_PROVIDER_ID = '5a2b3c4d-5e6f-7890-1234-56789abcdef0'

// A second, structurally distinct unresolved ship-mining provider used to regression-test the
// Fix-2 enrichment-grouping bug: two different local providers that both enrich to the same
// Wiki location identity must combine into one row via `combineProviderScores`, not emit two
// duplicate rows for the same physical place.
function secondUnresolvedProvider(): MiningCatalogProvider {
  return {
    id: SECOND_UNRESOLVED_PROVIDER_ID,
    key: 'HPP_LagrangeA_Occupied',
    locationId: null,
    locationName: null,
    groups: [
      {
        groupName: 'Ship_Mineables',
        groupProbability: 0.4,
        contributions: [
          {
            harvestablePresetId: HARVESTABLE_PRESET_ID,
            entityId: HADANITE_ENTITY_ID,
            relativeProbability: 0.08,
            clusterId: null,
            materials: [
              {
                materialId: HADANITE_MATERIAL_ID,
                effectiveQuality: HADANITE_QUALITY,
                usedLocationOverride: false,
                reachableQuantizedValues: REACHABLE_VALUES
              }
            ]
          }
        ]
      }
    ],
    areas: []
  }
}

function buildCatalog(
  providers: MiningCatalogProvider[] = [resolvedProvider(), unresolvedProvider()]
): MiningCatalog {
  return {
    schemaVersion: 1,
    gameVersion: '4.9.188.23497-LIVE',
    materials: [hadaniteCatalogMaterial()],
    entities: [
      {
        id: HADANITE_ENTITY_ID,
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_hadanite.xml',
        key: 'MineableRock_FPS_Hadanite',
        signature: 3_000,
        method: 'FPS',
        compositionId: null,
        depositName: 'Hadanite',
        minimumDistinctElements: 1,
        composition: [
          {
            materialId: HADANITE_MATERIAL_ID,
            minPercentage: 50,
            maxPercentage: 100,
            probability: 1,
            curveExponent: 1,
            qualityScale: 1,
            instability: 200,
            resistance: 0
          }
        ]
      }
    ],
    locations: [
      {
        id: ABERDEEN_ID,
        name: 'Aberdeen',
        parentId: 'hurston-id',
        parentName: 'Hurston',
        system: 'Stanton',
        type: 'Moon',
        providerIds: [HURSTON_PROVIDER_ID]
      }
    ],
    providers,
    clusters: [],
    warnings: []
  }
}

function hadaniteMaterial(): MiningMaterial {
  return {
    id: 'hadanite',
    commodityId: 'hadanite',
    name: 'Hadanite',
    displayName: 'Hadanite',
    signature: 3_000,
    methods: ['FPS'],
    sourceUrl: 'https://api.star-citizen.wiki/api/commodities/hadanite'
  }
}

function expectedResolvedProbability(qualityThreshold = 500): number {
  const qualityProbability = estimateQuantizedThresholdProbability(
    HADANITE_BANDS,
    HADANITE_QUALITY,
    qualityThreshold
  )
  return 0.25 * 0.06 * qualityProbability
}

test('buildLocalMiningLocations derives the resolved Aberdeen row entirely from local numbers', () => {
  const catalog = buildCatalog()
  const material = hadaniteMaterial()

  const locations = buildLocalMiningLocations(catalog, material, HADANITE_MATERIAL_ID)
  const aberdeen = locations.find((entry) => entry.id === ABERDEEN_ID)
  assert.ok(aberdeen)
  assert.equal(aberdeen.name, 'Aberdeen')
  assert.equal(aberdeen.system, 'Stanton')
  assert.equal(aberdeen.type, 'Moon')
  assert.equal(aberdeen.parentName, 'Hurston')
  assert.equal(aberdeen.identitySource, 'game')
  assert.equal(aberdeen.minComposition, 50)
  assert.equal(aberdeen.maxComposition, 100)
  assert.equal(aberdeen.minQuality, Math.min(...REACHABLE_VALUES))
  assert.equal(aberdeen.maxQuality, Math.max(...REACHABLE_VALUES))
  assert.ok(Math.abs((aberdeen.rockSpawnProbability ?? 0) - 0.25 * 0.06) < 1e-9)
  assert.ok(aberdeen.qualityThresholdProbability !== null)
  assert.ok(
    Math.abs(
      (aberdeen.qualityThresholdProbability ?? 0) -
        estimateQuantizedThresholdProbability(HADANITE_BANDS, HADANITE_QUALITY)
    ) < 1e-9
  )
  assert.ok(aberdeen.combinedProbability !== null)
  assert.ok(Math.abs((aberdeen.combinedProbability ?? 0) - expectedResolvedProbability()) < 1e-9)
  assert.equal(aberdeen.quantizationProbabilities.length, HADANITE_BANDS.length)
  assert.ok(
    Math.abs(
      aberdeen.quantizationProbabilities.reduce(
        (sum, quantization) => sum + quantization.probability,
        0
      ) - 1
    ) < 1e-9
  )
})

test('buildLocalMiningLocations applies a user-set raw quality threshold', () => {
  const locations = buildLocalMiningLocations(
    buildCatalog(),
    hadaniteMaterial(),
    HADANITE_MATERIAL_ID,
    new Map(),
    750
  )
  const aberdeen = locations.find((entry) => entry.id === ABERDEEN_ID)
  assert.ok(aberdeen)
  assert.ok(Math.abs((aberdeen.rockSpawnProbability ?? 0) - 0.015) < 1e-9)
  assert.ok(Math.abs((aberdeen.qualityThresholdProbability ?? 0) - 0.08702060242924659) < 1e-9)
  assert.ok(Math.abs((aberdeen.combinedProbability ?? 0) - 0.0013053090364386988) < 1e-9)
  assert.ok(
    Math.abs(
      aberdeen.quantizationProbabilities
        .filter((entry) => entry.quality >= 750)
        .reduce((sum, entry) => sum + entry.probability, 0) -
        (aberdeen.qualityThresholdProbability ?? 0)
    ) < 1e-9
  )
})

test('buildLocalMiningLocations keeps an unresolved real mining provider as a first-class row', () => {
  const catalog = buildCatalog()
  const material = hadaniteMaterial()

  const locations = buildLocalMiningLocations(catalog, material, HADANITE_MATERIAL_ID)
  const unresolved = locations.find((entry) => entry.id === `provider:${UNRESOLVED_PROVIDER_ID}`)
  assert.ok(unresolved)
  // Deterministic, transparent technical label - never a fabricated StarMap name.
  assert.equal(unresolved.name, 'Stanton2c Belt')
  assert.equal(unresolved.system, 'Unknown system')
  assert.equal(unresolved.type, 'Unresolved ship-mining provider')
  assert.equal(unresolved.parentName, null)
  assert.equal(unresolved.identitySource, 'game')
  assert.ok(unresolved.combinedProbability !== null)
})

test('buildLocalMiningLocations orders sites by combined chance', () => {
  const locations = buildLocalMiningLocations(
    buildCatalog(),
    hadaniteMaterial(),
    HADANITE_MATERIAL_ID
  )
  const probabilities = locations.map((entry) => entry.combinedProbability ?? -1)
  assert.deepEqual(
    probabilities,
    [...probabilities].sort((left, right) => right - left)
  )
})

test('buildLocalMiningLocations returns nothing when the catalog material id does not resolve', () => {
  const catalog = buildCatalog()
  const material = hadaniteMaterial()
  const unknownCatalogMaterialId = '00000000-0000-0000-0000-000000000000'
  assert.deepEqual(buildLocalMiningLocations(catalog, material, unknownCatalogMaterialId), [])
})

test('loadMiningLocations enriches an unresolved provider with one or more named Wiki locations, keeping local numbers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-local-locations-'))
  const cachePath = join(directory, 'locations.json')
  const originalFetch = globalThis.fetch
  try {
    const catalog = buildCatalog()
    const material = hadaniteMaterial()
    const baseline = buildLocalMiningLocations(catalog, material, HADANITE_MATERIAL_ID)
    const baselineAberdeen = baseline.find((entry) => entry.id === ABERDEEN_ID)
    assert.ok(baselineAberdeen)

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: {
            locations: [
              {
                uuid: 'wiki-loc-1',
                name: "Adair's Retreat",
                system: 'Stanton',
                type: 'Cave',
                parent_name: 'Aberdeen',
                link: 'https://example.com/wiki-loc-1',
                resources: [{ provider_names: ['HPP_Stanton2c_Belt'] }]
              },
              {
                uuid: 'wiki-loc-2',
                name: 'Adair Overlook',
                system: 'Stanton',
                type: 'Cave',
                parent_name: 'Aberdeen',
                link: 'https://example.com/wiki-loc-2',
                resources: [{ provider_names: ['HPP_Stanton2c_Belt'] }]
              }
            ]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )

    const result = await loadMiningLocations(cachePath, material, catalog, HADANITE_MATERIAL_ID)
    assert.equal(result.state, 'game')

    const enrichedNames = result.locations
      .filter((entry) => entry.identitySource === 'game-wiki')
      .map((entry) => entry.name)
      .sort()
    assert.deepEqual(enrichedNames, ['Adair Overlook', "Adair's Retreat"])

    // Wiki contributes only identity fields; the numeric fields must stay the local, authoritative
    // unresolved-provider score for every emitted named row.
    const rawUnresolvedScore = buildLocalMiningLocations(
      catalog,
      material,
      HADANITE_MATERIAL_ID
    ).find((entry) => entry.id === `provider:${UNRESOLVED_PROVIDER_ID}`)
    assert.ok(rawUnresolvedScore)
    for (const enriched of result.locations.filter(
      (entry) => entry.identitySource === 'game-wiki'
    )) {
      assert.equal(enriched.rockSpawnProbability, rawUnresolvedScore.rockSpawnProbability)
      assert.equal(
        enriched.qualityThresholdProbability,
        rawUnresolvedScore.qualityThresholdProbability
      )
      assert.equal(enriched.combinedProbability, rawUnresolvedScore.combinedProbability)
      assert.deepEqual(
        enriched.quantizationProbabilities,
        rawUnresolvedScore.quantizationProbabilities
      )
      assert.equal(enriched.minQuality, rawUnresolvedScore.minQuality)
      assert.equal(enriched.maxQuality, rawUnresolvedScore.maxQuality)
      assert.equal(enriched.minComposition, rawUnresolvedScore.minComposition)
      assert.equal(enriched.maxComposition, rawUnresolvedScore.maxComposition)
    }

    // The resolved Aberdeen row must be completely untouched by the Wiki enrichment pass.
    const aberdeenAfterEnrichment = result.locations.find((entry) => entry.id === ABERDEEN_ID)
    assert.ok(aberdeenAfterEnrichment)
    assert.equal(aberdeenAfterEnrichment.identitySource, 'game')
    assert.equal(aberdeenAfterEnrichment.combinedProbability, baselineAberdeen.combinedProbability)
    assert.equal(aberdeenAfterEnrichment.minComposition, baselineAberdeen.minComposition)
    assert.equal(aberdeenAfterEnrichment.maxComposition, baselineAberdeen.maxComposition)

    // No leftover raw technical-label row once every matching named location was emitted.
    assert.equal(
      result.locations.some((entry) => entry.id === `provider:${UNRESOLVED_PROVIDER_ID}`),
      false
    )
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test('loadMiningLocations keeps the unresolved provider row when Wiki enrichment is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-local-locations-noenrich-'))
  const cachePath = join(directory, 'locations.json')
  const originalFetch = globalThis.fetch
  try {
    const catalog = buildCatalog()
    const material = hadaniteMaterial()

    globalThis.fetch = async () => {
      throw new Error('network unavailable')
    }

    const result = await loadMiningLocations(cachePath, material, catalog, HADANITE_MATERIAL_ID)
    assert.equal(result.state, 'game')
    assert.match(result.message, /Location-name enrichment unavailable/)

    const unresolved = result.locations.find(
      (entry) => entry.id === `provider:${UNRESOLVED_PROVIDER_ID}`
    )
    assert.ok(unresolved)
    assert.equal(unresolved.identitySource, 'game')
    assert.equal(unresolved.name, 'Stanton2c Belt')
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test('loadMiningLocations falls back to the cached game-derived result when local scoring fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-local-locations-cache-'))
  const cachePath = join(directory, 'locations.json')
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      throw new Error('should not be called - no unresolved providers in this catalog')
    }

    const catalog = buildCatalog([resolvedProvider()])
    const material = hadaniteMaterial()

    const first = await loadMiningLocations(cachePath, material, catalog, HADANITE_MATERIAL_ID)
    assert.equal(first.state, 'game')

    // Simulate a corrupted/defensive-programming-violating catalog slipping through (e.g. an
    // internal invariant broken elsewhere) by dropping the material's quantization bands, which
    // makes the shared estimator throw instead of silently defaulting.
    const corruptCatalog: MiningCatalog = {
      ...catalog,
      materials: [{ ...hadaniteCatalogMaterial(), quantizationBands: undefined as unknown as [] }]
    }

    const second = await loadMiningLocations(
      cachePath,
      material,
      corruptCatalog,
      HADANITE_MATERIAL_ID
    )
    assert.equal(second.state, 'game-cached')
    assert.match(second.message, /Using cached mining site data\./)
    assert.deepEqual(second.locations, first.locations)
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test('loadMiningLocations does not reuse a cache created for another quality threshold', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-local-locations-threshold-cache-'))
  const cachePath = join(directory, 'locations.json')
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      throw new Error('should not be called - no unresolved providers in this catalog')
    }

    const catalog = buildCatalog([resolvedProvider()])
    const material = hadaniteMaterial()
    const first = await loadMiningLocations(cachePath, material, catalog, HADANITE_MATERIAL_ID, 500)
    assert.equal(first.qualityThreshold, 500)

    const corruptCatalog: MiningCatalog = {
      ...catalog,
      materials: [{ ...hadaniteCatalogMaterial(), quantizationBands: undefined as unknown as [] }]
    }
    await assert.rejects(
      () => loadMiningLocations(cachePath, material, corruptCatalog, HADANITE_MATERIAL_ID, 750),
      /no cached result exists/
    )
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

// Regression test for the Fix-2 enrichment-grouping bug: two structurally distinct unresolved
// providers that both enrich to the *same* Wiki location identity must combine into one stable
// row (via `combineProviderScores`, the same combinator used for providers sharing a resolved
// `locationId`) rather than emitting two duplicate rows for the same physical place.
test('loadMiningLocations combines two unresolved providers that enrich to the same Wiki location into one row', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-local-locations-collision-'))
  const cachePath = join(directory, 'locations.json')
  const originalFetch = globalThis.fetch
  try {
    const catalog = buildCatalog([
      resolvedProvider(),
      unresolvedProvider(),
      secondUnresolvedProvider()
    ])
    const material = hadaniteMaterial()

    // Individual raw (pre-enrichment) scores for each unresolved provider, derived from a
    // catalog containing only that one unresolved provider, so the expected combined
    // probability can be computed with the same `1 - Π(1 - p)` semantics as
    // `combineProviderScores` without duplicating its implementation.
    const soloFirst = buildLocalMiningLocations(
      buildCatalog([unresolvedProvider()]),
      material,
      HADANITE_MATERIAL_ID
    ).find((entry) => entry.id === `provider:${UNRESOLVED_PROVIDER_ID}`)
    const soloSecond = buildLocalMiningLocations(
      buildCatalog([secondUnresolvedProvider()]),
      material,
      HADANITE_MATERIAL_ID
    ).find((entry) => entry.id === `provider:${SECOND_UNRESOLVED_PROVIDER_ID}`)
    assert.ok(soloFirst && soloSecond)
    assert.ok(soloFirst.combinedProbability !== null && soloSecond.combinedProbability !== null)
    const expectedRockSpawn =
      1 - (1 - (soloFirst.rockSpawnProbability ?? 0)) * (1 - (soloSecond.rockSpawnProbability ?? 0))
    const expectedCombined =
      1 - (1 - (soloFirst.combinedProbability ?? 0)) * (1 - (soloSecond.combinedProbability ?? 0))
    const expectedConditional = expectedCombined / expectedRockSpawn

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: {
            locations: [
              {
                uuid: 'wiki-shared-loc',
                name: 'Shared Belt Outpost',
                system: 'Stanton',
                type: 'Outpost',
                parent_name: 'Stanton II',
                link: 'https://example.com/wiki-shared-loc',
                resources: [{ provider_names: ['HPP_Stanton2c_Belt', 'HPP_LagrangeA_Occupied'] }]
              }
            ]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )

    const result = await loadMiningLocations(cachePath, material, catalog, HADANITE_MATERIAL_ID)
    assert.equal(result.state, 'game')

    const combinedRows = result.locations.filter(
      (entry) => entry.id === 'wiki-location:wiki-shared-loc'
    )
    assert.equal(combinedRows.length, 1)
    const [combined] = combinedRows
    assert.equal(combined.name, 'Shared Belt Outpost')
    assert.equal(combined.identitySource, 'game-wiki')
    assert.ok(combined.combinedProbability !== null)
    assert.ok(Math.abs((combined.rockSpawnProbability ?? 0) - expectedRockSpawn) < 1e-9)
    assert.ok(Math.abs((combined.qualityThresholdProbability ?? 0) - expectedConditional) < 1e-9)
    assert.ok(Math.abs((combined.combinedProbability ?? 0) - expectedCombined) < 1e-9)
    assert.ok(
      Math.abs(
        combined.quantizationProbabilities
          .filter((entry) => entry.quality >= 500)
          .reduce((sum, entry) => sum + entry.probability, 0) - expectedConditional
      ) < 1e-9
    )
    assert.ok(
      Math.abs(
        combined.quantizationProbabilities.reduce((sum, entry) => sum + entry.probability, 0) - 1
      ) < 1e-9
    )

    // No leftover per-provider technical rows for either provider that fed the combined row.
    assert.equal(
      result.locations.some(
        (entry) =>
          entry.id === `provider:${UNRESOLVED_PROVIDER_ID}` ||
          entry.id === `provider:${SECOND_UNRESOLVED_PROVIDER_ID}`
      ),
      false
    )
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})
