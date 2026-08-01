import assert from 'node:assert/strict'
import test from 'node:test'

import { parseMiningExtractorPayload } from './mining-catalog'

const GAME_VERSION = '4.9.188.23497-LIVE'

const HADANITE_MATERIAL_ID = '3e5fdc37-cb59-4fd3-8168-e3c538ab9722'
const HADANITE_ENTITY_ID = '3998d58a-4021-4697-9432-2162aff01c73'
const HADANITE_COMPOSITION_ID = 'b67114a3-683b-49be-b6a5-c712e7338901'
const PROVIDER_ID = '8f6fb27e-e373-4eaa-991b-7c55303f4bbc'
const ABERDEEN_ID = 'f8f07f5b-1c0e-47c9-aa50-46963065bf18'
const HURSTON_ID = '551af60b-7727-4936-acc7-763d25d7a1de'
const CLUSTER_ID = 'd3bc17e2-7a06-450a-82a0-1c5774329054'
const HARVESTABLE_PRESET_ID = 'f42be172-0391-4482-b3ff-6f97c2182272'

const MATERIAL_COUNT = 10
const ENTITY_COUNT = 20
const PROVIDER_COUNT = 30

function fillerGuid(prefix: number, index: number): string {
  return `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function hadaniteMaterial(): Record<string, unknown> {
  return {
    id: HADANITE_MATERIAL_ID,
    key: 'Hadanite',
    slug: 'hadanite',
    name: 'Hadanite',
    densityGramsPerCubicCentimeter: 2.2,
    instability: 200,
    resistance: 0,
    defaultQuality: { min: 201, max: 1_000, mean: 201, stdDev: 298 },
    qualityLocationOverrides: [],
    quantizationBands: [
      { start: 0, end: 399, mappedValue: 274 },
      { start: 400, end: 599, mappedValue: 526 },
      { start: 600, end: 699, mappedValue: 665 },
      { start: 700, end: 799, mappedValue: 762 },
      { start: 800, end: 899, mappedValue: 867 },
      { start: 900, end: 949, mappedValue: 916 },
      { start: 950, end: 998, mappedValue: 959 },
      { start: 999, end: 1_000, mappedValue: 1_000 }
    ]
  }
}

function fillerMaterial(index: number): Record<string, unknown> {
  return {
    id: fillerGuid(1, index),
    key: `Material_${index}`,
    slug: `material-${index}`,
    name: `Material ${index}`,
    densityGramsPerCubicCentimeter: null,
    instability: null,
    resistance: null,
    defaultQuality: null,
    qualityLocationOverrides: [],
    quantizationBands: []
  }
}

function hadaniteEntity(): Record<string, unknown> {
  return {
    id: HADANITE_ENTITY_ID,
    path: 'libs/foundry/records/entities/mineable/mineablerock_fps_hadanite.xml',
    key: 'MineableRock_FPS_Hadanite',
    signature: 3_000,
    method: 'FPS',
    compositionId: HADANITE_COMPOSITION_ID,
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
}

function fillerEntity(index: number): Record<string, unknown> {
  return {
    id: fillerGuid(2, index),
    path: `libs/foundry/records/entities/mineable/mineablerock_fps_filler${index}.xml`,
    key: `MineableRock_FPS_Filler${index}`,
    signature: 1_000 + index,
    method: 'FPS',
    compositionId: null,
    depositName: null,
    minimumDistinctElements: null,
    composition: [
      {
        materialId: fillerGuid(1, ((index - 1) % (MATERIAL_COUNT - 1)) + 1),
        minPercentage: 10,
        maxPercentage: 100,
        probability: 1,
        curveExponent: 1,
        qualityScale: 1,
        instability: null,
        resistance: null
      }
    ]
  }
}

function hadaniteProvider(): Record<string, unknown> {
  return {
    id: PROVIDER_ID,
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
            clusterId: CLUSTER_ID,
            materials: [
              {
                materialId: HADANITE_MATERIAL_ID,
                effectiveQuality: { min: 201, max: 1_000, mean: 201, stdDev: 298 },
                usedLocationOverride: false,
                reachableQuantizedValues: [274, 526, 665, 762, 867, 916, 959, 1_000]
              }
            ]
          }
        ]
      }
    ],
    areas: []
  }
}

function fillerProvider(index: number): Record<string, unknown> {
  return {
    id: fillerGuid(3, index),
    key: `HPP_Filler${index}`,
    locationId: null,
    locationName: null,
    groups: [],
    areas: []
  }
}

function aberdeenLocation(): Record<string, unknown> {
  return {
    id: ABERDEEN_ID,
    name: 'Aberdeen',
    parentId: HURSTON_ID,
    parentName: 'Hurston',
    system: 'Stanton',
    type: 'Moon',
    providerIds: [PROVIDER_ID]
  }
}

function hadaniteCluster(): Record<string, unknown> {
  return {
    id: CLUSTER_ID,
    key: 'MiningCluster_Med_Lrg',
    probability: 1,
    buckets: [
      { probability: 0.2, minSize: 10, maxSize: 22, minProximity: 3, maxProximity: 5 },
      { probability: 0.3, minSize: 13, maxSize: 24, minProximity: 2, maxProximity: 8 },
      { probability: 0.5, minSize: 15, maxSize: 25, minProximity: 1.5, maxProximity: 10 }
    ]
  }
}

function buildPayload(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    gameVersion: GAME_VERSION,
    materials: [hadaniteMaterial(), ...Array.from({ length: MATERIAL_COUNT - 1 }, (_, i) => fillerMaterial(i + 1))],
    entities: [hadaniteEntity(), ...Array.from({ length: ENTITY_COUNT - 1 }, (_, i) => fillerEntity(i + 1))],
    locations: [aberdeenLocation()],
    providers: [
      hadaniteProvider(),
      ...Array.from({ length: PROVIDER_COUNT - 1 }, (_, i) => fillerProvider(i + 1))
    ],
    clusters: [hadaniteCluster()],
    warnings: ['Named cave POI tier placement could not be resolved from local DataForge extraction.']
  }
}

test('parses the verified Hadanite/Aberdeen fixture and reproduces the oracle values', () => {
  const catalog = parseMiningExtractorPayload(buildPayload())

  assert.equal(catalog.gameVersion, GAME_VERSION)
  assert.equal(catalog.materials.length, MATERIAL_COUNT)
  assert.equal(catalog.entities.length, ENTITY_COUNT)
  assert.equal(catalog.providers.length, PROVIDER_COUNT)

  const hadanite = catalog.materials.find((material) => material.id === HADANITE_MATERIAL_ID)
  assert.ok(hadanite)
  assert.deepEqual(hadanite.defaultQuality, { min: 201, max: 1_000, mean: 201, stdDev: 298 })
  assert.deepEqual(
    hadanite.quantizationBands.map((band) => band.mappedValue),
    [274, 526, 665, 762, 867, 916, 959, 1_000]
  )

  const entity = catalog.entities.find((candidate) => candidate.id === HADANITE_ENTITY_ID)
  assert.ok(entity)
  assert.equal(entity.method, 'FPS')
  assert.equal(entity.signature, 3_000)
  assert.equal(entity.composition.length, 1)
  assert.equal(entity.composition[0].minPercentage, 50)
  assert.equal(entity.composition[0].maxPercentage, 100)
  assert.equal(entity.composition[0].curveExponent, 1)
  assert.equal(entity.composition[0].qualityScale, 1)

  const location = catalog.locations.find((candidate) => candidate.id === ABERDEEN_ID)
  assert.ok(location)
  assert.equal(location.parentName, 'Hurston')
  assert.equal(location.system, 'Stanton')
  assert.equal(location.type, 'Moon')

  const provider = catalog.providers.find((candidate) => candidate.id === PROVIDER_ID)
  assert.ok(provider)
  const group = provider.groups.find((candidate) => candidate.groupName === 'FPS_Mineables')
  assert.ok(group)
  assert.equal(group.groupProbability, 0.25)
  const contribution = group.contributions.find((candidate) => candidate.entityId === HADANITE_ENTITY_ID)
  assert.ok(contribution)
  assert.equal(contribution.relativeProbability, 0.06)
  assert.equal(contribution.clusterId, CLUSTER_ID)
  assert.deepEqual(contribution.materials[0].reachableQuantizedValues, [274, 526, 665, 762, 867, 916, 959, 1_000])

  const cluster = catalog.clusters.find((candidate) => candidate.id === CLUSTER_ID)
  assert.ok(cluster)
  assert.equal(cluster.probability, 1)
  assert.deepEqual(cluster.buckets, [
    { probability: 0.2, minSize: 10, maxSize: 22, minProximity: 3, maxProximity: 5 },
    { probability: 0.3, minSize: 13, maxSize: 24, minProximity: 2, maxProximity: 8 },
    { probability: 0.5, minSize: 15, maxSize: 25, minProximity: 1.5, maxProximity: 10 }
  ])
})

test('rejects an unsupported schema version', () => {
  const payload = buildPayload()
  payload.schemaVersion = 2
  assert.throws(() => parseMiningExtractorPayload(payload), /unsupported mining response/)
})

test('rejects catalogs below the minimum record counts', () => {
  const missingMaterials = buildPayload()
  missingMaterials.materials = [hadaniteMaterial()]
  assert.throws(() => parseMiningExtractorPayload(missingMaterials), /complete mining material catalog/)

  const missingEntities = buildPayload()
  missingEntities.entities = [hadaniteEntity()]
  assert.throws(() => parseMiningExtractorPayload(missingEntities), /complete mineable entity catalog/)

  const missingProviders = buildPayload()
  missingProviders.providers = [hadaniteProvider()]
  assert.throws(() => parseMiningExtractorPayload(missingProviders), /complete mining provider catalog/)
})

test('rejects oversized warning arrays', () => {
  const payload = buildPayload()
  payload.warnings = Array.from({ length: 1_001 }, (_, index) => `warning ${index}`)
  assert.throws(() => parseMiningExtractorPayload(payload), /unsupported mining response/)
})

test('rejects out-of-range probability, quality, and percentage values', () => {
  const badGroupProbability = buildPayload()
  ;(badGroupProbability.providers as Record<string, unknown>[])[0] = {
    ...hadaniteProvider(),
    groups: [{ ...(hadaniteProvider().groups as Record<string, unknown>[])[0], groupProbability: 1.5 }]
  }
  assert.throws(() => parseMiningExtractorPayload(badGroupProbability), /invalid mining record/)

  const badQuality = buildPayload()
  ;(badQuality.materials as Record<string, unknown>[])[0] = {
    ...hadaniteMaterial(),
    defaultQuality: { min: 201, max: 1_500, mean: 201, stdDev: 298 }
  }
  assert.throws(() => parseMiningExtractorPayload(badQuality), /invalid mining record/)

  const badPercentage = buildPayload()
  const entityWithBadComposition = hadaniteEntity() as { composition: Record<string, unknown>[] }
  entityWithBadComposition.composition = [{ ...entityWithBadComposition.composition[0], maxPercentage: 150 }]
  ;(badPercentage.entities as Record<string, unknown>[])[0] = entityWithBadComposition
  assert.throws(() => parseMiningExtractorPayload(badPercentage), /invalid mining record/)
})

test('rejects duplicate mining material identifiers', () => {
  const payload = buildPayload()
  ;(payload.materials as Record<string, unknown>[])[1] = { ...hadaniteMaterial(), key: 'Duplicate' }
  assert.throws(() => parseMiningExtractorPayload(payload), /duplicate mining material/)
})

test('rejects unresolved cross-catalog references', () => {
  const unknownEntityMaterial = buildPayload()
  const badEntity = hadaniteEntity() as { composition: Record<string, unknown>[] }
  badEntity.composition = [{ ...badEntity.composition[0], materialId: fillerGuid(9, 999) }]
  ;(unknownEntityMaterial.entities as Record<string, unknown>[])[0] = badEntity
  assert.throws(() => parseMiningExtractorPayload(unknownEntityMaterial), /unknown material identifier/)

  const unknownContributionEntity = buildPayload()
  const badProvider = hadaniteProvider() as { groups: Record<string, unknown>[] }
  const badGroup = badProvider.groups[0] as { contributions: Record<string, unknown>[] }
  badGroup.contributions = [{ ...badGroup.contributions[0], entityId: fillerGuid(9, 999) }]
  ;(unknownContributionEntity.providers as Record<string, unknown>[])[0] = badProvider
  assert.throws(
    () => parseMiningExtractorPayload(unknownContributionEntity),
    /unknown mineable entity identifier/
  )

  const unknownLocation = buildPayload()
  ;(unknownLocation.providers as Record<string, unknown>[])[0] = {
    ...hadaniteProvider(),
    locationId: fillerGuid(9, 999)
  }
  assert.throws(() => parseMiningExtractorPayload(unknownLocation), /unknown location identifier/)
})
