/**
 * Strict parser for the local extractor's `mining` mode payload, plus a caching wrapper
 * (`loadMiningCatalog`) that lets the rest of the app prefer installed game data for material
 * identity and mining-site quality/composition math, skipping the ~5s extraction on ordinary
 * startup by keying a full-catalog cache on schema version, archive fingerprint, and channel.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

import type { LocalizationSource } from '../shared/contracts'

const execFileAsync = promisify(execFile)

const EXTRACTOR_SCHEMA_VERSION = 1
const CATALOG_CACHE_SCHEMA_VERSION = 2

const MIN_MATERIAL_COUNT = 10
const MIN_ENTITY_COUNT = 20
const MIN_PROVIDER_COUNT = 30
const MAX_CATALOG_RECORD_COUNT = 5_000

const MAX_WARNING_COUNT = 1_000
const MAX_STRING_LENGTH = 4_000
const MAX_PATH_LENGTH = 1_000

const MAX_QUALITY_OVERRIDES_PER_MATERIAL = 100
const MAX_QUANTIZATION_BANDS_PER_MATERIAL = 100
const MAX_COMPOSITION_PARTS_PER_ENTITY = 50
const MAX_GROUPS_PER_PROVIDER = 50
const MAX_CONTRIBUTIONS_PER_GROUP = 500
const MAX_MATERIALS_PER_CONTRIBUTION = 100
const MAX_REACHABLE_VALUES_PER_CONTRIBUTION = 100
const MAX_AREAS_PER_PROVIDER = 50
const MAX_EXCEPTIONS_PER_AREA = 500
const MAX_BUCKETS_PER_CLUSTER = 50

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MINING_METHODS = new Set(['Ship', 'Ground Vehicle', 'FPS'])

export interface MiningQualityDistribution {
  min: number
  max: number
  mean: number
  stdDev: number
}

export interface MiningQualityLocationOverride {
  locationId: string
  locationName: string | null
  distribution: MiningQualityDistribution
}

export interface MiningQuantizationBand {
  start: number
  end: number
  mappedValue: number
}

export interface MiningCatalogMaterial {
  id: string
  key: string
  slug: string
  name: string
  densityGramsPerCubicCentimeter: number | null
  instability: number | null
  resistance: number | null
  defaultQuality: MiningQualityDistribution | null
  qualityLocationOverrides: MiningQualityLocationOverride[]
  quantizationBands: MiningQuantizationBand[]
}

export type MiningCatalogMethod = 'Ship' | 'Ground Vehicle' | 'FPS'

export interface MiningCompositionPart {
  materialId: string
  minPercentage: number
  maxPercentage: number
  probability: number
  curveExponent: number
  qualityScale: number
  instability: number | null
  resistance: number | null
}

export interface MiningCatalogEntity {
  id: string
  path: string
  key: string
  signature: number
  method: MiningCatalogMethod
  compositionId: string | null
  depositName: string | null
  minimumDistinctElements: number | null
  composition: MiningCompositionPart[]
}

export interface MiningCatalogLocation {
  id: string
  name: string
  parentId: string | null
  parentName: string | null
  system: string | null
  type: string
  providerIds: string[]
}

export interface MiningContributionMaterial {
  materialId: string
  effectiveQuality: MiningQualityDistribution
  usedLocationOverride: boolean
  reachableQuantizedValues: number[]
}

export interface MiningContribution {
  harvestablePresetId: string
  entityId: string
  relativeProbability: number
  clusterId: string | null
  materials: MiningContributionMaterial[]
}

export interface MiningProviderGroup {
  groupName: string
  groupProbability: number
  contributions: MiningContribution[]
}

export interface MiningAreaException {
  harvestablePresetId: string
  modifier: number
}

export interface MiningArea {
  debugName: string
  globalModifier: number
  exceptions: MiningAreaException[]
}

export interface MiningCatalogProvider {
  id: string
  key: string
  locationId: string | null
  locationName: string | null
  groups: MiningProviderGroup[]
  areas: MiningArea[]
}

export interface MiningClusterBucket {
  probability: number
  minSize: number
  maxSize: number
  minProximity: number
  maxProximity: number
}

export interface MiningCatalogCluster {
  id: string
  key: string
  probability: number
  buckets: MiningClusterBucket[]
}

export interface MiningCatalog {
  schemaVersion: number
  gameVersion: string
  materials: MiningCatalogMaterial[]
  entities: MiningCatalogEntity[]
  locations: MiningCatalogLocation[]
  providers: MiningCatalogProvider[]
  clusters: MiningCatalogCluster[]
  warnings: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function isBoundedArray(value: unknown, maxLength: number): value is unknown[] {
  return Array.isArray(value) && value.length <= maxLength
}

function readString(
  value: Record<string, unknown>,
  key: string,
  maxLength = MAX_STRING_LENGTH
): string | null {
  const candidate = value[key]
  return typeof candidate === 'string' &&
    candidate.trim().length > 0 &&
    candidate.length <= maxLength
    ? candidate
    : null
}

function readNullableString(
  value: Record<string, unknown>,
  key: string,
  maxLength = MAX_STRING_LENGTH
): string | null | undefined {
  const candidate = value[key]
  if (candidate === null) return null
  return typeof candidate === 'string' &&
    candidate.trim().length > 0 &&
    candidate.length <= maxLength
    ? candidate
    : undefined
}

function readGuid(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key]
  return typeof candidate === 'string' && GUID_PATTERN.test(candidate) ? candidate : null
}

function readNullableGuid(value: Record<string, unknown>, key: string): string | null | undefined {
  const candidate = value[key]
  if (candidate === null) return null
  return typeof candidate === 'string' && GUID_PATTERN.test(candidate) ? candidate : undefined
}

function readFiniteNumber(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function readNullableFiniteNumber(
  value: Record<string, unknown>,
  key: string
): number | null | undefined {
  const candidate = value[key]
  if (candidate === null) return null
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined
}

function readNonNegativeNumber(value: Record<string, unknown>, key: string): number | null {
  const candidate = readFiniteNumber(value, key)
  return candidate !== null && candidate >= 0 ? candidate : null
}

function readCount(value: Record<string, unknown>, key: string): number | null {
  const candidate = readFiniteNumber(value, key)
  return candidate !== null && Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null
}

function readNullableCount(value: Record<string, unknown>, key: string): number | null | undefined {
  const candidate = value[key]
  if (candidate === null) return null
  return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
    ? candidate
    : undefined
}

function readUnitInterval(value: Record<string, unknown>, key: string): number | null {
  const candidate = readFiniteNumber(value, key)
  return candidate !== null && candidate >= 0 && candidate <= 1 ? candidate : null
}

function readPercentage(value: Record<string, unknown>, key: string): number | null {
  const candidate = readFiniteNumber(value, key)
  return candidate !== null && candidate >= 0 && candidate <= 100 ? candidate : null
}

function readQualityValue(value: Record<string, unknown>, key: string): number | null {
  const candidate = readFiniteNumber(value, key)
  return candidate !== null && candidate >= 0 && candidate <= 1_000 ? candidate : null
}

function uniqueIds<T extends { id: string }>(records: readonly T[], label: string): void {
  const seen = new Set<string>()
  for (const record of records) {
    const normalized = record.id.toLowerCase()
    if (seen.has(normalized)) {
      throw new TypeError(`The game data extractor returned duplicate ${label} identifiers.`)
    }
    seen.add(normalized)
  }
}

function parseQualityDistribution(value: unknown): MiningQualityDistribution | null {
  if (!isRecord(value)) return null
  const min = readQualityValue(value, 'min')
  const max = readQualityValue(value, 'max')
  const mean = readQualityValue(value, 'mean')
  const stdDev = readNonNegativeNumber(value, 'stdDev')
  if (min === null || max === null || mean === null || stdDev === null || min > max) return null
  return { min, max, mean, stdDev }
}

function parseQualityLocationOverride(value: unknown): MiningQualityLocationOverride | null {
  if (!isRecord(value)) return null
  const locationId = readGuid(value, 'locationId')
  const locationName = readNullableString(value, 'locationName', 500)
  const distribution = parseQualityDistribution(value.distribution)
  if (!locationId || locationName === undefined || !distribution) return null
  return { locationId, locationName, distribution }
}

function parseQuantizationBand(value: unknown): MiningQuantizationBand | null {
  if (!isRecord(value)) return null
  const start = readQualityValue(value, 'start')
  const end = readQualityValue(value, 'end')
  const mappedValue = readQualityValue(value, 'mappedValue')
  if (start === null || end === null || mappedValue === null || start > end) return null
  return { start, end, mappedValue }
}

function parseMaterial(value: unknown): MiningCatalogMaterial | null {
  if (
    !isRecord(value) ||
    !isBoundedArray(value.qualityLocationOverrides, MAX_QUALITY_OVERRIDES_PER_MATERIAL)
  ) {
    return null
  }
  if (!isBoundedArray(value.quantizationBands, MAX_QUANTIZATION_BANDS_PER_MATERIAL)) return null

  const id = readGuid(value, 'id')
  const key = readString(value, 'key', 300)
  const slug = readString(value, 'slug', 300)
  const name = readString(value, 'name', 300)
  const density = readNullableFiniteNumber(value, 'densityGramsPerCubicCentimeter')
  const instability = readNullableFiniteNumber(value, 'instability')
  const resistance = readNullableFiniteNumber(value, 'resistance')
  const defaultQuality =
    value.defaultQuality === null ? null : parseQualityDistribution(value.defaultQuality)
  if (
    !id ||
    !key ||
    !slug ||
    !name ||
    density === undefined ||
    (density !== null && density <= 0) ||
    instability === undefined ||
    resistance === undefined ||
    (value.defaultQuality !== null && !defaultQuality)
  ) {
    return null
  }

  const overrides = value.qualityLocationOverrides.map(parseQualityLocationOverride)
  const bands = value.quantizationBands.map(parseQuantizationBand)
  if (overrides.some((entry) => entry === null) || bands.some((entry) => entry === null)) {
    return null
  }

  return {
    id,
    key,
    slug,
    name,
    densityGramsPerCubicCentimeter: density,
    instability,
    resistance,
    defaultQuality,
    qualityLocationOverrides: overrides as MiningQualityLocationOverride[],
    quantizationBands: bands as MiningQuantizationBand[]
  }
}

function parseCompositionPart(value: unknown): MiningCompositionPart | null {
  if (!isRecord(value)) return null
  const materialId = readGuid(value, 'materialId')
  const minPercentage = readPercentage(value, 'minPercentage')
  const maxPercentage = readPercentage(value, 'maxPercentage')
  const probability = readUnitInterval(value, 'probability')
  const curveExponent = readFiniteNumber(value, 'curveExponent')
  const qualityScale = readFiniteNumber(value, 'qualityScale')
  const instability = readNullableFiniteNumber(value, 'instability')
  const resistance = readNullableFiniteNumber(value, 'resistance')
  if (
    !materialId ||
    minPercentage === null ||
    maxPercentage === null ||
    minPercentage > maxPercentage ||
    probability === null ||
    curveExponent === null ||
    qualityScale === null ||
    instability === undefined ||
    resistance === undefined
  ) {
    return null
  }
  return {
    materialId,
    minPercentage,
    maxPercentage,
    probability,
    curveExponent,
    qualityScale,
    instability,
    resistance
  }
}

function parseEntity(value: unknown): MiningCatalogEntity | null {
  if (!isRecord(value) || !isBoundedArray(value.composition, MAX_COMPOSITION_PARTS_PER_ENTITY)) {
    return null
  }
  const id = readGuid(value, 'id')
  const path = readString(value, 'path', MAX_PATH_LENGTH)
  const key = readString(value, 'key', 300)
  const signature = readCount(value, 'signature')
  const compositionId = readNullableGuid(value, 'compositionId')
  const depositName = readNullableString(value, 'depositName', 500)
  const minimumDistinctElements = readNullableCount(value, 'minimumDistinctElements')
  if (
    !id ||
    !path ||
    !key ||
    signature === null ||
    signature <= 0 ||
    typeof value.method !== 'string' ||
    !MINING_METHODS.has(value.method) ||
    compositionId === undefined ||
    depositName === undefined ||
    minimumDistinctElements === undefined ||
    value.composition.length === 0
  ) {
    return null
  }

  const composition = value.composition.map(parseCompositionPart)
  if (composition.some((part) => part === null)) return null

  return {
    id,
    path,
    key,
    signature,
    method: value.method as MiningCatalogMethod,
    compositionId,
    depositName,
    minimumDistinctElements,
    composition: composition as MiningCompositionPart[]
  }
}

function parseLocation(value: unknown): MiningCatalogLocation | null {
  if (!isRecord(value) || !isBoundedArray(value.providerIds, MAX_CATALOG_RECORD_COUNT)) return null
  const id = readGuid(value, 'id')
  const name = readString(value, 'name', 300)
  const parentId = readNullableGuid(value, 'parentId')
  const parentName = readNullableString(value, 'parentName', 300)
  const system = readNullableString(value, 'system', 300)
  const type = readString(value, 'type', 100)
  if (
    !id ||
    !name ||
    parentId === undefined ||
    parentName === undefined ||
    system === undefined ||
    !type
  ) {
    return null
  }
  const providerIds = value.providerIds.every(
    (entry): entry is string => typeof entry === 'string' && GUID_PATTERN.test(entry)
  )
    ? (value.providerIds as string[])
    : null
  if (!providerIds) return null
  return { id, name, parentId, parentName, system, type, providerIds }
}

function parseContributionMaterial(value: unknown): MiningContributionMaterial | null {
  if (
    !isRecord(value) ||
    !isBoundedArray(value.reachableQuantizedValues, MAX_REACHABLE_VALUES_PER_CONTRIBUTION)
  ) {
    return null
  }
  const materialId = readGuid(value, 'materialId')
  const effectiveQuality = parseQualityDistribution(value.effectiveQuality)
  if (!materialId || !effectiveQuality || typeof value.usedLocationOverride !== 'boolean')
    return null
  const reachableQuantizedValues = value.reachableQuantizedValues.every(
    (entry): entry is number =>
      typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 1_000
  )
    ? (value.reachableQuantizedValues as number[])
    : null
  if (!reachableQuantizedValues) return null
  return {
    materialId,
    effectiveQuality,
    usedLocationOverride: value.usedLocationOverride,
    reachableQuantizedValues
  }
}

function parseContribution(value: unknown): MiningContribution | null {
  if (!isRecord(value) || !isBoundedArray(value.materials, MAX_MATERIALS_PER_CONTRIBUTION))
    return null
  const harvestablePresetId = readGuid(value, 'harvestablePresetId')
  const entityId = readGuid(value, 'entityId')
  const relativeProbability = readUnitInterval(value, 'relativeProbability')
  const clusterId = readNullableGuid(value, 'clusterId')
  if (
    !harvestablePresetId ||
    !entityId ||
    relativeProbability === null ||
    clusterId === undefined
  ) {
    return null
  }
  const materials = value.materials.map(parseContributionMaterial)
  if (materials.some((entry) => entry === null)) return null
  return {
    harvestablePresetId,
    entityId,
    relativeProbability,
    clusterId,
    materials: materials as MiningContributionMaterial[]
  }
}

function parseProviderGroup(value: unknown): MiningProviderGroup | null {
  if (!isRecord(value) || !isBoundedArray(value.contributions, MAX_CONTRIBUTIONS_PER_GROUP))
    return null
  const groupName = readString(value, 'groupName', 300)
  const groupProbability = readUnitInterval(value, 'groupProbability')
  if (!groupName || groupProbability === null) return null
  const contributions = value.contributions.map(parseContribution)
  if (contributions.some((entry) => entry === null)) return null
  return { groupName, groupProbability, contributions: contributions as MiningContribution[] }
}

function parseAreaException(value: unknown): MiningAreaException | null {
  if (!isRecord(value)) return null
  const harvestablePresetId = readGuid(value, 'harvestablePresetId')
  const modifier = readFiniteNumber(value, 'modifier')
  if (!harvestablePresetId || modifier === null) return null
  return { harvestablePresetId, modifier }
}

function parseArea(value: unknown): MiningArea | null {
  if (!isRecord(value) || !isBoundedArray(value.exceptions, MAX_EXCEPTIONS_PER_AREA)) return null
  const debugName = readString(value, 'debugName', 300)
  const globalModifier = readFiniteNumber(value, 'globalModifier')
  if (!debugName || globalModifier === null) return null
  const exceptions = value.exceptions.map(parseAreaException)
  if (exceptions.some((entry) => entry === null)) return null
  return { debugName, globalModifier, exceptions: exceptions as MiningAreaException[] }
}

function parseProvider(value: unknown): MiningCatalogProvider | null {
  if (
    !isRecord(value) ||
    !isBoundedArray(value.groups, MAX_GROUPS_PER_PROVIDER) ||
    !isBoundedArray(value.areas, MAX_AREAS_PER_PROVIDER)
  ) {
    return null
  }
  const id = readGuid(value, 'id')
  const key = readString(value, 'key', 300)
  const locationId = readNullableGuid(value, 'locationId')
  const locationName = readNullableString(value, 'locationName', 300)
  if (!id || !key || locationId === undefined || locationName === undefined) return null

  const groups = value.groups.map(parseProviderGroup)
  const areas = value.areas.map(parseArea)
  if (groups.some((entry) => entry === null) || areas.some((entry) => entry === null)) return null

  return {
    id,
    key,
    locationId,
    locationName,
    groups: groups as MiningProviderGroup[],
    areas: areas as MiningArea[]
  }
}

function parseClusterBucket(value: unknown): MiningClusterBucket | null {
  if (!isRecord(value)) return null
  const probability = readUnitInterval(value, 'probability')
  const minSize = readNonNegativeNumber(value, 'minSize')
  const maxSize = readNonNegativeNumber(value, 'maxSize')
  const minProximity = readNonNegativeNumber(value, 'minProximity')
  const maxProximity = readNonNegativeNumber(value, 'maxProximity')
  if (
    probability === null ||
    minSize === null ||
    maxSize === null ||
    minSize > maxSize ||
    minProximity === null ||
    maxProximity === null ||
    minProximity > maxProximity
  ) {
    return null
  }
  return { probability, minSize, maxSize, minProximity, maxProximity }
}

function parseCluster(value: unknown): MiningCatalogCluster | null {
  if (!isRecord(value) || !isBoundedArray(value.buckets, MAX_BUCKETS_PER_CLUSTER)) return null
  const id = readGuid(value, 'id')
  const key = readString(value, 'key', 300)
  const probability = readUnitInterval(value, 'probability')
  if (!id || !key || probability === null) return null
  const buckets = value.buckets.map(parseClusterBucket)
  if (buckets.some((entry) => entry === null)) return null
  return { id, key, probability, buckets: buckets as MiningClusterBucket[] }
}

/**
 * Strictly validates and normalizes a `mining` mode extractor payload.
 * Throws a `TypeError` for any structural or range violation, and an
 * `Error` for cross-reference/duplicate-identifier violations. Never
 * silently drops or defaults invalid data.
 */
export function parseMiningExtractorPayload(value: unknown): MiningCatalog {
  if (
    !isRecord(value) ||
    value.schemaVersion !== EXTRACTOR_SCHEMA_VERSION ||
    !isBoundedArray(value.materials, MAX_CATALOG_RECORD_COUNT) ||
    !isBoundedArray(value.entities, MAX_CATALOG_RECORD_COUNT) ||
    !isBoundedArray(value.locations, MAX_CATALOG_RECORD_COUNT) ||
    !isBoundedArray(value.providers, MAX_CATALOG_RECORD_COUNT) ||
    !isBoundedArray(value.clusters, MAX_CATALOG_RECORD_COUNT) ||
    !isBoundedArray(value.warnings, MAX_WARNING_COUNT)
  ) {
    throw new TypeError('The game data extractor returned an unsupported mining response.')
  }
  if (value.materials.length < MIN_MATERIAL_COUNT) {
    throw new TypeError(
      'The installed game data did not contain a complete mining material catalog.'
    )
  }
  if (value.entities.length < MIN_ENTITY_COUNT) {
    throw new TypeError(
      'The installed game data did not contain a complete mineable entity catalog.'
    )
  }
  if (value.providers.length < MIN_PROVIDER_COUNT) {
    throw new TypeError(
      'The installed game data did not contain a complete mining provider catalog.'
    )
  }

  const gameVersion = readString(value, 'gameVersion', 300)
  if (!gameVersion) {
    throw new TypeError('The game data extractor returned an invalid game version.')
  }

  const materials = value.materials.map(parseMaterial)
  const entities = value.entities.map(parseEntity)
  const locations = value.locations.map(parseLocation)
  const providers = value.providers.map(parseProvider)
  const clusters = value.clusters.map(parseCluster)
  if (
    materials.some((entry) => entry === null) ||
    entities.some((entry) => entry === null) ||
    locations.some((entry) => entry === null) ||
    providers.some((entry) => entry === null) ||
    clusters.some((entry) => entry === null)
  ) {
    throw new TypeError('The game data extractor returned an invalid mining record.')
  }

  const warnings = value.warnings.every(
    (entry): entry is string => typeof entry === 'string' && entry.length <= MAX_STRING_LENGTH
  )
    ? (value.warnings as string[])
    : null
  if (!warnings) {
    throw new TypeError('The game data extractor returned an invalid mining warning.')
  }

  const typedMaterials = materials as MiningCatalogMaterial[]
  const typedEntities = entities as MiningCatalogEntity[]
  const typedLocations = locations as MiningCatalogLocation[]
  const typedProviders = providers as MiningCatalogProvider[]
  const typedClusters = clusters as MiningCatalogCluster[]

  uniqueIds(typedMaterials, 'mining material')
  uniqueIds(typedEntities, 'mineable entity')
  uniqueIds(typedLocations, 'mining location')
  uniqueIds(typedProviders, 'mining provider')
  uniqueIds(typedClusters, 'mining cluster')

  const materialIds = new Set(typedMaterials.map((material) => material.id.toLowerCase()))
  const entityIds = new Set(typedEntities.map((entity) => entity.id.toLowerCase()))
  const locationIds = new Set(typedLocations.map((location) => location.id.toLowerCase()))
  const clusterIds = new Set(typedClusters.map((cluster) => cluster.id.toLowerCase()))

  for (const entity of typedEntities) {
    for (const part of entity.composition) {
      if (!materialIds.has(part.materialId.toLowerCase())) {
        throw new Error(
          `Mineable entity '${entity.key}' references an unknown material identifier: ${part.materialId}.`
        )
      }
    }
  }

  for (const material of typedMaterials) {
    for (const override of material.qualityLocationOverrides) {
      if (!locationIds.has(override.locationId.toLowerCase())) {
        throw new Error(
          `Material '${material.key}' references an unknown location override identifier: ${override.locationId}.`
        )
      }
    }
  }

  for (const provider of typedProviders) {
    if (provider.locationId && !locationIds.has(provider.locationId.toLowerCase())) {
      throw new Error(
        `Provider '${provider.key}' references an unknown location identifier: ${provider.locationId}.`
      )
    }
    for (const group of provider.groups) {
      for (const contribution of group.contributions) {
        if (!entityIds.has(contribution.entityId.toLowerCase())) {
          throw new Error(
            `Provider '${provider.key}' group '${group.groupName}' references an unknown mineable entity identifier: ${contribution.entityId}.`
          )
        }
        if (contribution.clusterId && !clusterIds.has(contribution.clusterId.toLowerCase())) {
          throw new Error(
            `Provider '${provider.key}' group '${group.groupName}' references an unknown cluster identifier: ${contribution.clusterId}.`
          )
        }
        for (const material of contribution.materials) {
          if (!materialIds.has(material.materialId.toLowerCase())) {
            throw new Error(
              `Provider '${provider.key}' group '${group.groupName}' references an unknown material identifier: ${material.materialId}.`
            )
          }
        }
      }
    }
  }

  for (const location of typedLocations) {
    const providerIds = new Set(typedProviders.map((provider) => provider.id.toLowerCase()))
    for (const providerId of location.providerIds) {
      if (!providerIds.has(providerId.toLowerCase())) {
        throw new Error(
          `Location '${location.name}' references an unknown provider identifier: ${providerId}.`
        )
      }
    }
  }

  return {
    schemaVersion: value.schemaVersion,
    gameVersion,
    materials: typedMaterials,
    entities: typedEntities,
    locations: typedLocations,
    providers: typedProviders,
    clusters: typedClusters,
    warnings
  }
}

/**
 * Runs the local game data extractor in `mining` mode against the given
 * Data.p4k archive and returns the strictly validated mining catalog.
 */
export async function extractMiningCatalog(
  extractorPath: string,
  archivePath: string,
  localizationSource: LocalizationSource = 'game'
): Promise<MiningCatalog> {
  try {
    const { stdout } = await execFileAsync(
      extractorPath,
      [archivePath, 'mining', localizationSource],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 300_000,
        windowsHide: true
      }
    )
    return parseMiningExtractorPayload(JSON.parse(stdout) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(
        `Installed game mining data could not be extracted: extractor not found at ${extractorPath}.`,
        {
          cause: error
        }
      )
    }
    const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : ''
    const message = stderr || (error instanceof Error ? error.message : String(error))
    throw new Error(`Installed game mining data could not be extracted: ${message}`, {
      cause: error
    })
  }
}

// --- Full-catalog caching --------------------------------------------------------------

export interface MiningCatalogCacheSource {
  archiveFingerprint: string
  channel: string
}

interface MiningCatalogCache {
  schemaVersion: number
  savedAt: string
  source: MiningCatalogCacheSource
  catalog: MiningCatalog
}

export interface LoadMiningCatalogOptions {
  cachePath: string
  extractorPath: string
  archivePath: string
  archiveFingerprint: string
  channel: string
  localizationSource?: LocalizationSource
  forceRefresh?: boolean
}

export interface LoadMiningCatalogResult {
  catalog: MiningCatalog
  /** `true` when served from `cachePath` without re-running the extractor. */
  fromCache: boolean
  updatedAt: string
  /** Set when a cache existed but could not be used (e.g. corrupted), so extraction ran instead. */
  cacheWarning: string | null
}

function parseCatalogCacheSource(value: unknown): MiningCatalogCacheSource | null {
  if (
    !isRecord(value) ||
    typeof value.archiveFingerprint !== 'string' ||
    value.archiveFingerprint.length === 0 ||
    typeof value.channel !== 'string' ||
    value.channel.length === 0
  ) {
    return null
  }
  return { archiveFingerprint: value.archiveFingerprint, channel: value.channel }
}

async function readMiningCatalogCache(cachePath: string): Promise<MiningCatalogCache | null> {
  let payload: unknown
  try {
    payload = JSON.parse(await fs.readFile(cachePath, 'utf8'))
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw new Error(
      `The mining catalog cache could not be read: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error
      }
    )
  }

  if (
    !isRecord(payload) ||
    typeof payload.schemaVersion !== 'number' ||
    typeof payload.savedAt !== 'string' ||
    !payload.savedAt
  ) {
    throw new Error('The mining catalog cache has an unexpected shape.')
  }

  const source = parseCatalogCacheSource(payload.source)
  if (!source) {
    throw new Error('The mining catalog cache has an invalid source record.')
  }

  // Strictly re-validate the cached catalog with the same parser used for a fresh extraction, so
  // a hand-edited or corrupted cache file cannot silently smuggle unvalidated data into the app.
  const catalog = parseMiningExtractorPayload(payload.catalog)

  return {
    schemaVersion: payload.schemaVersion,
    savedAt: payload.savedAt,
    source,
    catalog
  }
}

async function writeMiningCatalogCache(
  cachePath: string,
  source: MiningCatalogCacheSource,
  catalog: MiningCatalog
): Promise<string> {
  const savedAt = new Date().toISOString()
  const cache: MiningCatalogCache = {
    schemaVersion: CATALOG_CACHE_SCHEMA_VERSION,
    savedAt,
    source,
    catalog
  }
  await fs.mkdir(dirname(cachePath), { recursive: true })
  const temporaryPath = `${cachePath}.tmp`
  await fs.writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  await fs.rename(temporaryPath, cachePath)
  return savedAt
}

/**
 * Loads the full local `MiningCatalog`, preferring a cache hit keyed on schema version, archive
 * fingerprint, and channel over re-running the extractor. Invalidated whenever the fingerprint or
 * channel changes (a different install/update was selected), the schema version bumps, or
 * `forceRefresh` is requested. A corrupt/unreadable cache never blocks loading - it is treated as
 * a miss and surfaced via `cacheWarning` so callers can report it, mirroring the existing
 * material-signature cache's behavior. A failed extraction still throws explicitly.
 */
export async function loadMiningCatalog(
  options: LoadMiningCatalogOptions
): Promise<LoadMiningCatalogResult> {
  let cache: MiningCatalogCache | null = null
  let cacheWarning: string | null = null
  try {
    cache = await readMiningCatalogCache(options.cachePath)
  } catch (error) {
    cacheWarning = error instanceof Error ? error.message : String(error)
  }

  if (
    !options.forceRefresh &&
    cache &&
    cache.schemaVersion === CATALOG_CACHE_SCHEMA_VERSION &&
    cache.source.archiveFingerprint === options.archiveFingerprint &&
    cache.source.channel === options.channel
  ) {
    return { catalog: cache.catalog, fromCache: true, updatedAt: cache.savedAt, cacheWarning }
  }

  const catalog = await extractMiningCatalog(
    options.extractorPath,
    options.archivePath,
    options.localizationSource ?? 'game'
  )
  const updatedAt = await writeMiningCatalogCache(
    options.cachePath,
    { archiveFingerprint: options.archiveFingerprint, channel: options.channel },
    catalog
  )
  return { catalog, fromCache: false, updatedAt, cacheWarning }
}
