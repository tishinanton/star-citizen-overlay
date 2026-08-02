import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

import {
  DEFAULT_MINING_QUALITY_THRESHOLD,
  type MiningQuantizationProbability,
  type MiningLocationRecommendation,
  type MiningLocationResult,
  type MiningLocationSourceState,
  type MiningMaterial,
  type MiningRockCluster,
  type MiningRockCompositionPart,
  type MiningRockType
} from '../shared/contracts'
import {
  type AreaCandidate,
  clampProbability,
  combineIndependentQuantizationProbabilities,
  estimateHighQualityProbability,
  estimateQuantizedThresholdProbability,
  estimateQuantizedValueProbabilities,
  scoreProbabilityBreakdown,
  type ProbabilityScoredContribution
} from './mining-estimator'
import {
  type MiningCatalog,
  type MiningCatalogCluster,
  type MiningCatalogEntity,
  type MiningCatalogMaterial,
  type MiningCatalogProvider,
  type MiningContribution,
  type MiningContributionMaterial,
  type MiningProviderGroup
} from './mining-catalog'

export { estimateHighQualityProbability } from './mining-estimator'

const COMMODITY_URL = 'https://api.star-citizen.wiki/api/commodities'
const cacheWriteQueues = new Map<string, Promise<void>>()

interface MiningLocationCache {
  entries: Record<string, MiningLocationCacheEntry>
}

interface MiningLocationCacheEntry {
  savedAt: string
  qualityThreshold: number
  locations: MiningLocationRecommendation[]
  /** Which pipeline produced these numbers, so a cache hit can be labelled 'game-cached' vs 'cached'. */
  source: 'game' | 'wiki'
}

function locationCacheEntryKey(materialId: string, qualityThreshold: number): string {
  return JSON.stringify([materialId, qualityThreshold])
}

function getLocationCacheEntry(
  cache: MiningLocationCache,
  materialId: string,
  qualityThreshold: number
): MiningLocationCacheEntry | undefined {
  const thresholdEntry = cache.entries[locationCacheEntryKey(materialId, qualityThreshold)]
  if (thresholdEntry) return thresholdEntry

  const legacyEntry = cache.entries[materialId]
  return legacyEntry?.qualityThreshold === qualityThreshold ? legacyEntry : undefined
}

interface DepositContribution extends ProbabilityScoredContribution {
  minQuality: number
  maxQuality: number
  maxComposition: number | null
  minComposition: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function probability(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null
}

function parseAreaModifiers(value: unknown): Map<string, number> {
  const modifiers = new Map<string, number>()
  if (!Array.isArray(value)) return modifiers

  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.name !== 'string') continue
    const modifier = finiteNumber(entry.modifier)
    if (modifier !== null && modifier >= 0) modifiers.set(entry.name, modifier)
  }

  return modifiers
}

function parseAreaCandidates(value: unknown): AreaCandidate[] {
  const areas: AreaCandidate[] = [{ name: null, globalModifier: 1 }]
  if (!Array.isArray(value)) return areas

  const uniqueAreas = new Map<string, number>()
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name.trim()) continue
    const modifier = finiteNumber(entry.global_modifier)
    if (modifier === null || modifier <= 0) continue
    uniqueAreas.set(entry.name.trim(), Math.max(modifier, uniqueAreas.get(entry.name.trim()) ?? 0))
  }

  for (const [name, globalModifier] of uniqueAreas) {
    areas.push({ name, globalModifier })
  }
  return areas
}

function wikiPercentage(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : null
}

function wikiQuality(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed !== null && parsed >= 0 && parsed <= 1_000 ? parsed : null
}

function parseWikiQuantizedValues(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter(
        (entry): entry is number =>
          typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 1_000
      )
    )
  ].sort((left, right) => left - right)
}

function parseWikiRockCluster(value: unknown): MiningRockCluster | null {
  if (!isRecord(value)) return null
  const key = typeof value.key === 'string' && value.key.trim() ? value.key.trim() : 'Cluster'
  const clusterProbability = probability(value.probability)
  const minSize = finiteNumber(value.min_size)
  const maxSize = finiteNumber(value.max_size)
  if (
    clusterProbability === null ||
    (minSize !== null && minSize < 0) ||
    (maxSize !== null && (maxSize < 0 || (minSize !== null && maxSize < minSize)))
  ) {
    return null
  }
  return { key, probability: clusterProbability, minSize, maxSize }
}

function parseWikiRockType(
  value: unknown,
  commodityUuid: string,
  index: number
): MiningRockType | null {
  if (!isRecord(value) || !Array.isArray(value.materials)) return null

  const compositions = value.materials
    .map((entry, compositionIndex): MiningRockCompositionPart | null => {
      if (!isRecord(entry)) return null
      const materialId =
        typeof entry.uuid === 'string' && entry.uuid.trim()
          ? entry.uuid.trim()
          : typeof entry.key === 'string' && entry.key.trim()
            ? entry.key.trim()
            : `composition-${compositionIndex}`
      const name =
        typeof entry.name === 'string' && entry.name.trim()
          ? entry.name.trim()
          : typeof entry.key === 'string' && entry.key.trim()
            ? entry.key.trim().replaceAll('_', ' ')
            : materialId
      const minPercentage = wikiPercentage(entry.min_percentage)
      const maxPercentage = wikiPercentage(entry.max_percentage)
      const minQuality = wikiQuality(entry.quality_min)
      const maxQuality = wikiQuality(entry.quality_max)
      if (
        (minPercentage !== null && maxPercentage !== null && minPercentage > maxPercentage) ||
        (minQuality !== null && maxQuality !== null && minQuality > maxQuality)
      ) {
        return null
      }
      return {
        id: `${materialId}:${compositionIndex}`,
        materialId,
        name,
        isTarget: entry.uuid === commodityUuid || entry.is_current === true,
        minPercentage,
        maxPercentage,
        probability: null,
        qualityScale: null,
        curveExponent: null,
        minQuality,
        maxQuality,
        meanQuality: wikiQuality(entry.quality_mean),
        qualityStdDev: finiteNumber(entry.quality_stddev),
        quantizedValues: parseWikiQuantizedValues(
          entry.quality_quantized_values ?? entry.quality_quantization
        ),
        quantizationProbabilities: []
      }
    })
    .filter((entry): entry is MiningRockCompositionPart => entry !== null)
  const targetComposition = compositions.find((entry) => entry.isTarget)
  if (!targetComposition) return null
  const targetMaterial = value.materials.find(
    (entry) => isRecord(entry) && (entry.uuid === commodityUuid || entry.is_current === true)
  ) as Record<string, unknown> | undefined

  const key =
    typeof value.key === 'string' && value.key.trim() ? value.key.trim() : `Rock type ${index + 1}`
  const name = key.startsWith('MineableRock_')
    ? humanizeRockTypeKey(key)
    : typeof value.label === 'string' && value.label.trim()
      ? value.label.trim()
      : humanizeRockTypeKey(key)
  const signature = finiteNumber(value.signature)
  return {
    id:
      typeof value.resource_uuid === 'string' && value.resource_uuid.trim()
        ? value.resource_uuid.trim()
        : `wiki-rock:${index}`,
    key,
    name,
    signature: signature !== null && signature >= 0 ? signature : null,
    groupName:
      typeof value.group_name === 'string' && value.group_name.trim()
        ? value.group_name.trim()
        : 'Mineables',
    groupProbability: probability(targetMaterial?.group_probability ?? value.group_probability),
    relativeProbability: probability(
      targetMaterial?.relative_probability ?? value.relative_probability_min
    ),
    minimumCompositionCount: null,
    cluster: parseWikiRockCluster(value.clustering),
    compositions
  }
}

function parseDepositContribution(
  value: unknown,
  commodityUuid: string,
  qualityThreshold: number
): DepositContribution | null {
  if (!isRecord(value) || !Array.isArray(value.materials)) return null

  const targetMaterials = value.materials.filter(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) &&
      (entry.uuid === commodityUuid || entry.is_current === true) &&
      finiteNumber(entry.quality_min) !== null &&
      finiteNumber(entry.quality_max) !== null
  )

  if (targetMaterials.length === 0) return null

  let noHighQualityProbability = 1
  let groupProbability: number | null = null
  let relativeProbability: number | null = null
  let minQuality = Number.POSITIVE_INFINITY
  let maxQuality = 0
  let minComposition: number | null = null
  let maxComposition: number | null = null

  for (const material of targetMaterials) {
    const qualityMin = finiteNumber(material.quality_min)
    const qualityMax = finiteNumber(material.quality_max)
    if (qualityMin === null || qualityMax === null || qualityMax < qualityMin) continue

    const qualityProbability = estimateHighQualityProbability(
      qualityMin,
      qualityMax,
      finiteNumber(material.quality_mean),
      finiteNumber(material.quality_stddev),
      qualityThreshold
    )
    noHighQualityProbability *= 1 - qualityProbability
    minQuality = Math.min(minQuality, qualityMin)
    maxQuality = Math.max(maxQuality, qualityMax)

    const materialGroupProbability = probability(material.group_probability)
    if (materialGroupProbability !== null) {
      groupProbability = Math.max(groupProbability ?? 0, materialGroupProbability)
    }
    const materialRelativeProbability = probability(material.relative_probability)
    if (materialRelativeProbability !== null) {
      relativeProbability = Math.max(relativeProbability ?? 0, materialRelativeProbability)
    }
    const materialMinComposition = finiteNumber(material.min_percentage)
    if (materialMinComposition !== null) {
      minComposition = (minComposition ?? 0) + materialMinComposition
    }
    const materialMaxComposition = finiteNumber(material.max_percentage)
    if (materialMaxComposition !== null) {
      maxComposition = (maxComposition ?? 0) + materialMaxComposition
    }
  }

  if (!Number.isFinite(minQuality)) return null

  return {
    groupName: typeof value.group_name === 'string' ? value.group_name : 'mineable',
    groupProbability,
    relativeProbability,
    highQualityProbability: 1 - noHighQualityProbability,
    quantizationProbabilities: [],
    minQuality,
    maxQuality,
    minComposition,
    maxComposition,
    areaModifiers: parseAreaModifiers(value.area_exceptions)
  }
}

function parseLocation(
  value: unknown,
  commodityUuid: string,
  qualityThreshold: number
): MiningLocationRecommendation | null {
  if (!isRecord(value) || !Array.isArray(value.resources)) return null

  const id = typeof value.uuid === 'string' ? value.uuid : ''
  const name =
    typeof value.display_name === 'string' && value.display_name.trim()
      ? value.display_name.trim()
      : typeof value.name === 'string'
        ? value.name.trim()
        : ''
  const system = typeof value.system === 'string' ? value.system.trim() : ''
  const type = typeof value.type === 'string' ? value.type.trim() : ''
  if (!id || !name || !system || !type) return null

  const contributions = value.resources
    .map((resource) => parseDepositContribution(resource, commodityUuid, qualityThreshold))
    .filter((entry): entry is DepositContribution => entry !== null)
  if (contributions.length === 0) return null
  const rockTypes = value.resources
    .map((resource, index) => parseWikiRockType(resource, commodityUuid, index))
    .filter((entry): entry is MiningRockType => entry !== null)

  let bestArea: AreaCandidate = { name: null, globalModifier: 1 }
  let probability = scoreProbabilityBreakdown(contributions, bestArea)
  for (const area of parseAreaCandidates(value.areas).slice(1)) {
    const areaProbability = scoreProbabilityBreakdown(contributions, area)
    if (
      areaProbability.combinedProbability !== null &&
      (probability.combinedProbability === null ||
        areaProbability.combinedProbability > probability.combinedProbability)
    ) {
      bestArea = area
      probability = areaProbability
    }
  }

  return {
    id,
    name,
    area: bestArea.name,
    system,
    type,
    parentName: typeof value.parent_name === 'string' ? value.parent_name : null,
    rockSpawnProbability: probability.rockSpawnProbability,
    qualityThresholdProbability: probability.qualityThresholdProbability,
    combinedProbability: probability.combinedProbability,
    quantizationProbabilities: [],
    minQuality: Math.min(...contributions.map((contribution) => contribution.minQuality)),
    maxQuality: Math.max(...contributions.map((contribution) => contribution.maxQuality)),
    minComposition: contributions.reduce<number | null>(
      (minimum, contribution) =>
        contribution.minComposition === null
          ? minimum
          : minimum === null
            ? contribution.minComposition
            : Math.min(minimum, contribution.minComposition),
      null
    ),
    maxComposition: contributions.reduce<number | null>(
      (maximum, contribution) =>
        contribution.maxComposition === null
          ? maximum
          : Math.max(maximum ?? 0, contribution.maxComposition),
      null
    ),
    rockTypes,
    identitySource: 'wiki',
    sourceUrl:
      typeof value.link === 'string'
        ? value.link
        : `https://api.star-citizen.wiki/api/locations/${id}`
  }
}

function sortRecommendations(
  left: MiningLocationRecommendation,
  right: MiningLocationRecommendation
): number {
  const probabilityDifference = (right.combinedProbability ?? -1) - (left.combinedProbability ?? -1)
  return (
    probabilityDifference ||
    right.maxQuality - left.maxQuality ||
    (right.maxComposition ?? 0) - (left.maxComposition ?? 0) ||
    left.name.localeCompare(right.name)
  )
}

export function parseMiningLocationRecommendations(
  payload: unknown,
  materialId: string,
  qualityThreshold = DEFAULT_MINING_QUALITY_THRESHOLD
): MiningLocationRecommendation[] {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.locations)) {
    throw new Error('Star Citizen Wiki API returned unexpected mining location data.')
  }

  const commodityUuid = typeof payload.data.uuid === 'string' ? payload.data.uuid : ''
  const commoditySlug = typeof payload.data.slug === 'string' ? payload.data.slug : ''
  if (!commodityUuid || commoditySlug !== materialId) {
    throw new Error('Star Citizen Wiki API returned mining locations for another material.')
  }

  return payload.data.locations
    .map((location) => parseLocation(location, commodityUuid, qualityThreshold))
    .filter((location): location is MiningLocationRecommendation => location !== null)
    .sort(sortRecommendations)
}

export function resolvePreferredMiningLocation(
  locations: readonly MiningLocationRecommendation[],
  favoriteLocationId: string | undefined
): MiningLocationRecommendation | null {
  return (
    (favoriteLocationId
      ? locations.find((location) => location.id === favoriteLocationId)
      : undefined) ??
    locations[0] ??
    null
  )
}

// --- Local-catalog derivation (installed game data path) ---------------------------------

function humanizeRockTypeKey(key: string): string {
  return key
    .replace(/^MineableRock_/i, '')
    .replaceAll('_', ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
}

function summarizeCluster(cluster: MiningCatalogCluster | undefined): MiningRockCluster | null {
  if (!cluster) return null
  return {
    key: cluster.key,
    probability: cluster.probability,
    minSize:
      cluster.buckets.length > 0
        ? Math.min(...cluster.buckets.map((bucket) => bucket.minSize))
        : null,
    maxSize:
      cluster.buckets.length > 0
        ? Math.max(...cluster.buckets.map((bucket) => bucket.maxSize))
        : null
  }
}

function buildLocalRockType(
  provider: MiningCatalogProvider,
  group: MiningProviderGroup,
  contribution: MiningContribution,
  entity: MiningCatalogEntity,
  catalogMaterialId: string,
  materialsById: ReadonlyMap<string, MiningCatalogMaterial>,
  clustersById: ReadonlyMap<string, MiningCatalogCluster>
): MiningRockType {
  const qualityByMaterialId = new Map<string, MiningContributionMaterial[]>()
  for (const material of contribution.materials) {
    const queue = qualityByMaterialId.get(material.materialId) ?? []
    queue.push(material)
    qualityByMaterialId.set(material.materialId, queue)
  }

  const compositions = entity.composition.map((part, index): MiningRockCompositionPart => {
    const contributionMaterial = qualityByMaterialId.get(part.materialId)?.shift() ?? null
    const catalogMaterial = materialsById.get(part.materialId)
    return {
      id: `${part.materialId}:${index}`,
      materialId: part.materialId,
      name: catalogMaterial?.name ?? part.materialId,
      isTarget: part.materialId === catalogMaterialId,
      minPercentage: part.minPercentage,
      maxPercentage: part.maxPercentage,
      probability: part.probability,
      qualityScale: part.qualityScale,
      curveExponent: part.curveExponent,
      minQuality: contributionMaterial?.effectiveQuality.min ?? null,
      maxQuality: contributionMaterial?.effectiveQuality.max ?? null,
      meanQuality: contributionMaterial?.effectiveQuality.mean ?? null,
      qualityStdDev: contributionMaterial?.effectiveQuality.stdDev ?? null,
      quantizedValues: contributionMaterial?.reachableQuantizedValues ?? [],
      quantizationProbabilities:
        contributionMaterial && catalogMaterial
          ? estimateQuantizedValueProbabilities(
              catalogMaterial.quantizationBands,
              contributionMaterial.effectiveQuality
            )
          : []
    }
  })

  return {
    id: `${provider.id}:${group.groupName}:${contribution.harvestablePresetId}`,
    key: entity.key,
    name: humanizeRockTypeKey(entity.key),
    signature: entity.signature,
    groupName: group.groupName,
    groupProbability: group.groupProbability,
    relativeProbability: contribution.relativeProbability,
    minimumCompositionCount: entity.minimumDistinctElements,
    cluster: contribution.clusterId
      ? summarizeCluster(clustersById.get(contribution.clusterId))
      : null,
    compositions
  }
}

interface ProviderScore {
  bestArea: AreaCandidate
  rockSpawnProbability: number | null
  qualityThresholdProbability: number | null
  combinedProbability: number | null
  quantizationProbabilities: MiningQuantizationProbability[]
  minQuality: number
  maxQuality: number
  minComposition: number | null
  maxComposition: number | null
  rockTypes: MiningRockType[]
}

/**
 * Scores a single `MiningCatalogProvider` against one target material: builds one
 * `ScoredContribution` per group/contribution that mines the material, then reuses the shared
 * `scoreContributions` combinator (same formula as the Wiki pipeline) to pick the best area and
 * the resulting user-threshold chance. Returns `null` when the provider has no contribution referencing
 * `catalogMaterialId` at all (most providers only mine a handful of the ~38 materials).
 */
function scoreProvider(
  provider: MiningCatalogProvider,
  catalogMaterialId: string,
  catalogMaterial: MiningCatalogMaterial,
  entitiesById: ReadonlyMap<string, MiningCatalogEntity>,
  materialsById: ReadonlyMap<string, MiningCatalogMaterial>,
  clustersById: ReadonlyMap<string, MiningCatalogCluster>,
  qualityThreshold: number
): ProviderScore | null {
  const contributions: DepositContribution[] = []
  const rockTypes: MiningRockType[] = []

  for (const group of provider.groups) {
    for (const contribution of group.contributions) {
      const contributionMaterials = contribution.materials.filter(
        (entry) => entry.materialId === catalogMaterialId
      )
      if (contributionMaterials.length === 0) continue

      const entity = entitiesById.get(contribution.entityId)
      if (!entity) continue
      const compositionParts = entity.composition.filter(
        (part) => part.materialId === catalogMaterialId
      )
      const materialProbabilities = contributionMaterials.map((material) => ({
        highQualityProbability: estimateQuantizedThresholdProbability(
          catalogMaterial.quantizationBands,
          material.effectiveQuality,
          qualityThreshold
        ),
        quantizationProbabilities: estimateQuantizedValueProbabilities(
          catalogMaterial.quantizationBands,
          material.effectiveQuality
        )
      }))

      const areaModifiers = new Map<string, number>()
      for (const area of provider.areas) {
        const exception = area.exceptions.find(
          (entry) => entry.harvestablePresetId === contribution.harvestablePresetId
        )
        if (exception) areaModifiers.set(area.debugName, exception.modifier)
      }
      rockTypes.push(
        buildLocalRockType(
          provider,
          group,
          contribution,
          entity,
          catalogMaterialId,
          materialsById,
          clustersById
        )
      )

      contributions.push({
        groupName: group.groupName,
        groupProbability: group.groupProbability,
        relativeProbability: contribution.relativeProbability,
        highQualityProbability:
          1 -
          materialProbabilities.reduce(
            (noHighQuality, material) => noHighQuality * (1 - material.highQualityProbability),
            1
          ),
        quantizationProbabilities:
          materialProbabilities.length === 1
            ? materialProbabilities[0].quantizationProbabilities
            : combineIndependentQuantizationProbabilities(
                materialProbabilities.map((material) => ({
                  rockSpawnProbability: 1,
                  quantizationProbabilities: material.quantizationProbabilities
                }))
              ),
        minQuality: Math.min(
          ...contributionMaterials.map((material) => material.effectiveQuality.min)
        ),
        maxQuality: Math.max(
          ...contributionMaterials.map((material) => material.effectiveQuality.max)
        ),
        minComposition:
          compositionParts.length > 0
            ? compositionParts.reduce((sum, part) => sum + part.minPercentage, 0)
            : null,
        maxComposition:
          compositionParts.length > 0
            ? compositionParts.reduce((sum, part) => sum + part.maxPercentage, 0)
            : null,
        areaModifiers
      })
    }
  }

  if (contributions.length === 0) return null

  let bestArea: AreaCandidate = { name: null, globalModifier: 1 }
  let probability = scoreProbabilityBreakdown(contributions, bestArea)
  for (const area of provider.areas) {
    const candidate: AreaCandidate = { name: area.debugName, globalModifier: area.globalModifier }
    const areaProbability = scoreProbabilityBreakdown(contributions, candidate)
    if (
      areaProbability.combinedProbability !== null &&
      (probability.combinedProbability === null ||
        areaProbability.combinedProbability > probability.combinedProbability)
    ) {
      bestArea = candidate
      probability = areaProbability
    }
  }

  return {
    bestArea,
    rockSpawnProbability: probability.rockSpawnProbability,
    qualityThresholdProbability: probability.qualityThresholdProbability,
    combinedProbability: probability.combinedProbability,
    quantizationProbabilities: probability.quantizationProbabilities,
    minQuality: Math.min(...contributions.map((entry) => entry.minQuality)),
    maxQuality: Math.max(...contributions.map((entry) => entry.maxQuality)),
    minComposition: contributions.reduce<number | null>(
      (minimum, entry) =>
        entry.minComposition === null
          ? minimum
          : minimum === null
            ? entry.minComposition
            : Math.min(minimum, entry.minComposition),
      null
    ),
    maxComposition: contributions.reduce<number | null>(
      (maximum, entry) =>
        entry.maxComposition === null ? maximum : Math.max(maximum ?? 0, entry.maxComposition),
      null
    ),
    rockTypes
  }
}

/**
 * Combines multiple providers that resolved to the same `MiningCatalogLocation` (rare, but the
 * layer-1 model allows several distinct providers to share one StarMap location) as independent
 * "at least one deposit rolls high quality" events, matching the same combination semantics used
 * one level down for groups within a single provider.
 */
function combineProviderScores(scores: readonly ProviderScore[]): {
  rockSpawnProbability: number | null
  qualityThresholdProbability: number | null
  combinedProbability: number | null
  quantizationProbabilities: MiningQuantizationProbability[]
  minQuality: number
  maxQuality: number
  minComposition: number | null
  maxComposition: number | null
  rockTypes: MiningRockType[]
  area: string | null
} {
  let noRockProbability = 1
  let noThresholdProbability = 1
  let hasCompleteQuantization = true
  const quantizationDistributions: Array<{
    rockSpawnProbability: number
    quantizationProbabilities: readonly MiningQuantizationProbability[]
  }> = []
  for (const score of scores) {
    if (score.rockSpawnProbability === null) continue
    noRockProbability *= 1 - clampProbability(score.rockSpawnProbability)
    if (score.combinedProbability === null) continue
    noThresholdProbability *= 1 - clampProbability(score.combinedProbability)
    if (score.rockSpawnProbability <= Number.EPSILON) continue
    if (score.quantizationProbabilities.length === 0) {
      hasCompleteQuantization = false
      continue
    }
    quantizationDistributions.push({
      rockSpawnProbability: score.rockSpawnProbability,
      quantizationProbabilities: score.quantizationProbabilities
    })
  }

  const bestScore = scores.reduce((best, score) =>
    (score.combinedProbability ?? -1) > (best.combinedProbability ?? -1) ? score : best
  )
  const rockSpawnProbability = 1 - noRockProbability
  const combinedProbability = 1 - noThresholdProbability
  const qualityThresholdProbability =
    rockSpawnProbability > Number.EPSILON
      ? clampProbability(combinedProbability / rockSpawnProbability)
      : null

  return {
    rockSpawnProbability,
    qualityThresholdProbability,
    combinedProbability,
    quantizationProbabilities: hasCompleteQuantization
      ? combineIndependentQuantizationProbabilities(quantizationDistributions)
      : [],
    minQuality: Math.min(...scores.map((entry) => entry.minQuality)),
    maxQuality: Math.max(...scores.map((entry) => entry.maxQuality)),
    minComposition: scores.reduce<number | null>(
      (minimum, entry) =>
        entry.minComposition === null
          ? minimum
          : minimum === null
            ? entry.minComposition
            : Math.min(minimum, entry.minComposition),
      null
    ),
    maxComposition: scores.reduce<number | null>(
      (maximum, entry) =>
        entry.maxComposition === null ? maximum : Math.max(maximum ?? 0, entry.maxComposition),
      null
    ),
    rockTypes: [
      ...new Map(
        scores.flatMap((score) =>
          score.rockTypes.map((rockType) => [rockType.id, rockType] as const)
        )
      ).values()
    ],
    area: bestScore.bestArea.name
  }
}

/** A named Wiki location identity used only to label an otherwise-unresolved local provider. */
interface WikiLocationIdentity {
  id: string
  name: string
  system: string
  type: string
  parentName: string | null
  sourceUrl: string
}

const UNRESOLVED_PROVIDER_SYSTEM = 'Unknown system'
const UNRESOLVED_PROVIDER_TYPE = 'Unresolved ship-mining provider'

/**
 * Deterministically humanizes a local provider record key into a technical label (e.g.
 * `HPP_Stanton2c_Belt` -> `Stanton2c Belt`). This is never presented as a real StarMap location
 * name - it is only used when neither layer 1's structural resolution nor Wiki `provider_names`
 * enrichment can identify the provider.
 */
function humanizeProviderKey(key: string): string {
  const withoutPrefix = key.replace(/^HPP_/, '')
  const spaced = withoutPrefix
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .trim()
  return spaced.length > 0 ? spaced : key
}

/**
 * Builds every mining-site recommendation the installed game archive can supply for one
 * material: one row per `MiningCatalogLocation` resolved via layer 1's provider->location
 * mapping (or combined across multiple providers sharing a location), plus one row per
 * distinct Wiki-enriched location identity reachable from the unresolved providers (combined
 * across every unresolved provider that maps to that same identity, using the same
 * `combineProviderScores` semantics as resolved locations), plus one row per remaining
 * structurally unresolved real ship-mining provider with no identity match (kept as
 * first-class, never dropped). `wikiIdentityByProviderKey` is empty on the first pass; callers
 * that also want Wiki location-identity enrichment for unresolved providers call this twice
 * (see `loadMiningLocations`).
 */
export function buildLocalMiningLocations(
  catalog: MiningCatalog,
  material: MiningMaterial,
  catalogMaterialId: string,
  wikiIdentityByProviderKey: ReadonlyMap<string, readonly WikiLocationIdentity[]> = new Map(),
  qualityThreshold = DEFAULT_MINING_QUALITY_THRESHOLD
): MiningLocationRecommendation[] {
  const catalogMaterial = catalog.materials.find((entry) => entry.id === catalogMaterialId)
  if (!catalogMaterial) return []

  const locationsById = new Map(catalog.locations.map((entry) => [entry.id, entry]))
  const entitiesById = new Map(catalog.entities.map((entry) => [entry.id, entry]))
  const materialsById = new Map(catalog.materials.map((entry) => [entry.id, entry]))
  const clustersById = new Map(catalog.clusters.map((entry) => [entry.id, entry]))

  const resolvedProviders = new Map<string, MiningCatalogProvider[]>()
  const unresolvedProviders: MiningCatalogProvider[] = []
  for (const provider of catalog.providers) {
    if (provider.locationId) {
      const group = resolvedProviders.get(provider.locationId) ?? []
      group.push(provider)
      resolvedProviders.set(provider.locationId, group)
    } else {
      unresolvedProviders.push(provider)
    }
  }

  const recommendations: MiningLocationRecommendation[] = []

  for (const [locationId, providers] of resolvedProviders) {
    const location = locationsById.get(locationId)
    if (!location) continue // defensive; the layer-1 parser guarantees every locationId resolves

    const scores = providers
      .map((provider) =>
        scoreProvider(
          provider,
          catalogMaterialId,
          catalogMaterial,
          entitiesById,
          materialsById,
          clustersById,
          qualityThreshold
        )
      )
      .filter((score): score is ProviderScore => score !== null)
    if (scores.length === 0) continue

    const combined = combineProviderScores(scores)
    recommendations.push({
      id: location.id,
      name: location.name,
      area: combined.area,
      system: location.system ?? UNRESOLVED_PROVIDER_SYSTEM,
      type: location.type,
      parentName: location.parentName,
      rockSpawnProbability: combined.rockSpawnProbability,
      qualityThresholdProbability: combined.qualityThresholdProbability,
      combinedProbability: combined.combinedProbability,
      quantizationProbabilities: combined.quantizationProbabilities,
      minQuality: combined.minQuality,
      maxQuality: combined.maxQuality,
      minComposition: combined.minComposition,
      maxComposition: combined.maxComposition,
      rockTypes: combined.rockTypes,
      identitySource: 'game',
      sourceUrl: material.sourceUrl
    })
  }

  // Score every unresolved provider once, then split into those with a matched Wiki identity
  // and those without. A single provider can fan out to several identities (kept, one row per
  // identity); several distinct providers can also enrich to the *same* identity (e.g. two
  // different ship-mining presets both named as sources of one named cave/outpost) - those must
  // combine into one stable row via `combineProviderScores`, exactly like providers sharing a
  // resolved `locationId` above, instead of emitting duplicate rows for the same place.
  const scoresByIdentityId = new Map<
    string,
    { identity: WikiLocationIdentity; scores: ProviderScore[] }
  >()
  const withoutIdentity: Array<{ provider: MiningCatalogProvider; score: ProviderScore }> = []

  for (const provider of unresolvedProviders) {
    const score = scoreProvider(
      provider,
      catalogMaterialId,
      catalogMaterial,
      entitiesById,
      materialsById,
      clustersById,
      qualityThreshold
    )
    if (!score) continue

    const identities = wikiIdentityByProviderKey.get(provider.key)
    if (identities && identities.length > 0) {
      for (const identity of identities) {
        const group = scoresByIdentityId.get(identity.id) ?? { identity, scores: [] }
        group.scores.push(score)
        scoresByIdentityId.set(identity.id, group)
      }
      continue
    }

    withoutIdentity.push({ provider, score })
  }

  for (const { identity, scores } of scoresByIdentityId.values()) {
    const combined = combineProviderScores(scores)
    recommendations.push({
      id: `wiki-location:${identity.id}`,
      name: identity.name,
      area: combined.area,
      system: identity.system,
      type: identity.type,
      parentName: identity.parentName,
      rockSpawnProbability: combined.rockSpawnProbability,
      qualityThresholdProbability: combined.qualityThresholdProbability,
      combinedProbability: combined.combinedProbability,
      quantizationProbabilities: combined.quantizationProbabilities,
      minQuality: combined.minQuality,
      maxQuality: combined.maxQuality,
      minComposition: combined.minComposition,
      maxComposition: combined.maxComposition,
      rockTypes: combined.rockTypes,
      identitySource: 'game-wiki',
      sourceUrl: identity.sourceUrl
    })
  }

  for (const { provider, score } of withoutIdentity) {
    recommendations.push({
      id: `provider:${provider.id}`,
      name: humanizeProviderKey(provider.key),
      area: score.bestArea.name,
      system: UNRESOLVED_PROVIDER_SYSTEM,
      type: UNRESOLVED_PROVIDER_TYPE,
      parentName: null,
      rockSpawnProbability: score.rockSpawnProbability,
      qualityThresholdProbability: score.qualityThresholdProbability,
      combinedProbability: score.combinedProbability,
      quantizationProbabilities: score.quantizationProbabilities,
      minQuality: score.minQuality,
      maxQuality: score.maxQuality,
      minComposition: score.minComposition,
      maxComposition: score.maxComposition,
      rockTypes: score.rockTypes,
      identitySource: 'game',
      sourceUrl: material.sourceUrl
    })
  }

  return recommendations.sort(sortRecommendations)
}

function parseWikiProviderIdentity(
  value: unknown
): { identity: WikiLocationIdentity; providerNames: string[] } | null {
  if (!isRecord(value) || !Array.isArray(value.resources)) return null

  const id = typeof value.uuid === 'string' ? value.uuid : ''
  const name =
    typeof value.display_name === 'string' && value.display_name.trim()
      ? value.display_name.trim()
      : typeof value.name === 'string'
        ? value.name.trim()
        : ''
  const system = typeof value.system === 'string' ? value.system.trim() : ''
  const type = typeof value.type === 'string' ? value.type.trim() : ''
  if (!id || !name || !system || !type) return null

  const providerNames = new Set<string>()
  for (const resource of value.resources) {
    if (!isRecord(resource) || !Array.isArray(resource.provider_names)) continue
    for (const providerName of resource.provider_names) {
      if (typeof providerName === 'string' && providerName.trim()) {
        providerNames.add(providerName.trim())
      }
    }
  }
  if (providerNames.size === 0) return null

  return {
    identity: {
      id,
      name,
      system,
      type,
      parentName: typeof value.parent_name === 'string' ? value.parent_name : null,
      sourceUrl:
        typeof value.link === 'string'
          ? value.link
          : `https://api.star-citizen.wiki/api/locations/${id}`
    },
    providerNames: [...providerNames]
  }
}

/**
 * Parses a commodity-detail response solely to build a `provider key -> named location`
 * lookup (via the API's `resources[].provider_names` field), for enriching unresolved local
 * providers with a real name. This never reads group/relative probability, quality, composition,
 * area, or clustering fields from the payload - those always come from the local catalog when a
 * matching local provider/contribution exists.
 */
function parseWikiProviderIdentities(payload: unknown): Map<string, WikiLocationIdentity[]> {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.locations)) {
    throw new Error('Star Citizen Wiki API returned unexpected mining location data.')
  }

  const byProvider = new Map<string, Map<string, WikiLocationIdentity>>()
  for (const location of payload.data.locations) {
    const parsed = parseWikiProviderIdentity(location)
    if (!parsed) continue
    for (const providerName of parsed.providerNames) {
      const existing = byProvider.get(providerName) ?? new Map<string, WikiLocationIdentity>()
      existing.set(parsed.identity.id, parsed.identity)
      byProvider.set(providerName, existing)
    }
  }

  const result = new Map<string, WikiLocationIdentity[]>()
  for (const [providerName, identities] of byProvider) {
    result.set(providerName, [...identities.values()])
  }
  return result
}

async function fetchWikiProviderIdentities(
  material: MiningMaterial
): Promise<Map<string, WikiLocationIdentity[]>> {
  const response = await fetch(`${COMMODITY_URL}/${encodeURIComponent(material.commodityId)}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Rockfall/0.1 (Star Citizen mining overlay)'
    },
    signal: AbortSignal.timeout(12_000)
  })
  if (!response.ok) {
    throw new Error(`Star Citizen Wiki API returned HTTP ${response.status}.`)
  }
  return parseWikiProviderIdentities(await response.json())
}

// --- Star Citizen Wiki fallback path (unchanged behavior) ---------------------------------

async function fetchLiveMiningLocations(
  material: MiningMaterial,
  qualityThreshold: number
): Promise<MiningLocationRecommendation[]> {
  const response = await fetch(`${COMMODITY_URL}/${encodeURIComponent(material.commodityId)}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Rockfall/0.1 (Star Citizen mining overlay)'
    },
    signal: AbortSignal.timeout(12_000)
  })

  if (!response.ok) {
    throw new Error(`Star Citizen Wiki API returned HTTP ${response.status}.`)
  }

  return parseMiningLocationRecommendations(
    await response.json(),
    material.commodityId,
    qualityThreshold
  )
}

function parseCachedQuantizationProbabilities(
  value: unknown
): MiningQuantizationProbability[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100) return null

  const qualities = new Set<number>()
  const result: MiningQuantizationProbability[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const quality = finiteNumber(entry.quality)
    const entryProbability = probability(entry.probability)
    if (
      quality === null ||
      quality < 0 ||
      quality > 1_000 ||
      entryProbability === null ||
      qualities.has(quality)
    ) {
      return null
    }
    qualities.add(quality)
    result.push({ quality, probability: entryProbability })
  }
  return result.sort((left, right) => left.quality - right.quality)
}

function parseCachedQuantizedValues(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > 100) return null
  const values = new Set<number>()
  for (const entry of value) {
    if (
      typeof entry !== 'number' ||
      !Number.isFinite(entry) ||
      entry < 0 ||
      entry > 1_000 ||
      values.has(entry)
    ) {
      return null
    }
    values.add(entry)
  }
  return [...values].sort((left, right) => left - right)
}

function parseCachedRockComposition(value: unknown): MiningRockCompositionPart | null {
  if (!isRecord(value)) return null
  const minPercentage = value.minPercentage === null ? null : wikiPercentage(value.minPercentage)
  const maxPercentage = value.maxPercentage === null ? null : wikiPercentage(value.maxPercentage)
  const partProbability = value.probability === null ? null : probability(value.probability)
  const qualityScale = value.qualityScale === null ? null : finiteNumber(value.qualityScale)
  const curveExponent = value.curveExponent === null ? null : finiteNumber(value.curveExponent)
  const minQuality = value.minQuality === null ? null : wikiQuality(value.minQuality)
  const maxQuality = value.maxQuality === null ? null : wikiQuality(value.maxQuality)
  const meanQuality = value.meanQuality === null ? null : wikiQuality(value.meanQuality)
  const qualityStdDev = value.qualityStdDev === null ? null : finiteNumber(value.qualityStdDev)
  const quantizedValues = parseCachedQuantizedValues(value.quantizedValues)
  const quantizationProbabilities = parseCachedQuantizationProbabilities(
    value.quantizationProbabilities
  )
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.materialId !== 'string' ||
    !value.materialId ||
    typeof value.name !== 'string' ||
    !value.name ||
    typeof value.isTarget !== 'boolean' ||
    (value.minPercentage !== null && minPercentage === null) ||
    (value.maxPercentage !== null && maxPercentage === null) ||
    (minPercentage !== null && maxPercentage !== null && minPercentage > maxPercentage) ||
    (value.probability !== null && partProbability === null) ||
    (value.qualityScale !== null && (qualityScale === null || qualityScale < 0)) ||
    (value.curveExponent !== null && (curveExponent === null || curveExponent < 0)) ||
    (value.minQuality !== null && minQuality === null) ||
    (value.maxQuality !== null && maxQuality === null) ||
    (minQuality !== null && maxQuality !== null && minQuality > maxQuality) ||
    (value.meanQuality !== null && meanQuality === null) ||
    (value.qualityStdDev !== null && (qualityStdDev === null || qualityStdDev < 0)) ||
    quantizedValues === null ||
    quantizationProbabilities === null
  ) {
    return null
  }
  return {
    id: value.id,
    materialId: value.materialId,
    name: value.name,
    isTarget: value.isTarget,
    minPercentage,
    maxPercentage,
    probability: partProbability,
    qualityScale,
    curveExponent,
    minQuality,
    maxQuality,
    meanQuality,
    qualityStdDev,
    quantizedValues,
    quantizationProbabilities
  }
}

function parseCachedRockCluster(value: unknown): MiningRockCluster | null {
  if (!isRecord(value) || typeof value.key !== 'string' || !value.key) return null
  const clusterProbability = probability(value.probability)
  const minSize = value.minSize === null ? null : finiteNumber(value.minSize)
  const maxSize = value.maxSize === null ? null : finiteNumber(value.maxSize)
  if (
    clusterProbability === null ||
    (value.minSize !== null && (minSize === null || minSize < 0)) ||
    (value.maxSize !== null && (maxSize === null || maxSize < 0)) ||
    (minSize !== null && maxSize !== null && minSize > maxSize)
  ) {
    return null
  }
  return { key: value.key, probability: clusterProbability, minSize, maxSize }
}

function parseCachedRockType(value: unknown): MiningRockType | null {
  if (!isRecord(value) || !Array.isArray(value.compositions) || value.compositions.length > 100) {
    return null
  }
  const signature = value.signature === null ? null : finiteNumber(value.signature)
  const groupProbability =
    value.groupProbability === null ? null : probability(value.groupProbability)
  const relativeProbability =
    value.relativeProbability === null ? null : probability(value.relativeProbability)
  const minimumCompositionCount =
    value.minimumCompositionCount === null ? null : finiteNumber(value.minimumCompositionCount)
  const cluster = value.cluster === null ? null : parseCachedRockCluster(value.cluster)
  const compositions = value.compositions.map(parseCachedRockComposition)
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.key !== 'string' ||
    !value.key ||
    typeof value.name !== 'string' ||
    !value.name ||
    typeof value.groupName !== 'string' ||
    !value.groupName ||
    (value.signature !== null && (signature === null || signature < 0)) ||
    (value.groupProbability !== null && groupProbability === null) ||
    (value.relativeProbability !== null && relativeProbability === null) ||
    (value.minimumCompositionCount !== null &&
      (minimumCompositionCount === null ||
        minimumCompositionCount < 0 ||
        !Number.isSafeInteger(minimumCompositionCount))) ||
    (value.cluster !== null && cluster === null) ||
    compositions.some((entry) => entry === null)
  ) {
    return null
  }
  return {
    id: value.id,
    key: value.key,
    name: value.name,
    signature,
    groupName: value.groupName,
    groupProbability,
    relativeProbability,
    minimumCompositionCount,
    cluster,
    compositions: compositions as MiningRockCompositionPart[]
  }
}

function parseCachedRockTypes(value: unknown): MiningRockType[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 500) return null
  const rockTypes = value.map(parseCachedRockType)
  return rockTypes.some((entry) => entry === null) ? null : (rockTypes as MiningRockType[])
}

function parseCachedRecommendation(value: unknown): MiningLocationRecommendation | null {
  if (!isRecord(value)) return null

  const legacyCombined =
    value.highQualityProbability === null ? null : probability(value.highQualityProbability)
  const combinedProbability =
    value.combinedProbability === undefined
      ? legacyCombined
      : value.combinedProbability === null
        ? null
        : probability(value.combinedProbability)
  const rockSpawnProbability =
    value.rockSpawnProbability === undefined || value.rockSpawnProbability === null
      ? null
      : probability(value.rockSpawnProbability)
  const qualityThresholdProbability =
    value.qualityThresholdProbability === undefined || value.qualityThresholdProbability === null
      ? null
      : probability(value.qualityThresholdProbability)
  const quantizationProbabilities = parseCachedQuantizationProbabilities(
    value.quantizationProbabilities
  )
  const rockTypes = parseCachedRockTypes(value.rockTypes)
  const hasMinQuality = value.minQuality !== undefined && value.minQuality !== null
  const minQuality = hasMinQuality ? finiteNumber(value.minQuality) : null
  const maxQuality = finiteNumber(value.maxQuality)
  const hasMinComposition = value.minComposition !== undefined && value.minComposition !== null
  const minComposition = hasMinComposition ? finiteNumber(value.minComposition) : null
  const maxComposition = value.maxComposition === null ? null : finiteNumber(value.maxComposition)
  const identitySource =
    value.identitySource === 'game' || value.identitySource === 'game-wiki'
      ? value.identitySource
      : 'wiki'
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    (value.area !== null && typeof value.area !== 'string') ||
    typeof value.system !== 'string' ||
    typeof value.type !== 'string' ||
    (value.parentName !== null && typeof value.parentName !== 'string') ||
    (value.combinedProbability !== undefined &&
      value.combinedProbability !== null &&
      combinedProbability === null) ||
    (value.rockSpawnProbability !== undefined &&
      value.rockSpawnProbability !== null &&
      rockSpawnProbability === null) ||
    (value.qualityThresholdProbability !== undefined &&
      value.qualityThresholdProbability !== null &&
      qualityThresholdProbability === null) ||
    quantizationProbabilities === null ||
    rockTypes === null ||
    maxQuality === null ||
    maxQuality < 0 ||
    maxQuality > 1_000 ||
    (hasMinComposition && minComposition === null) ||
    (minComposition !== null && (minComposition < 0 || minComposition > 100)) ||
    (value.maxComposition !== null && maxComposition === null) ||
    (maxComposition !== null && (maxComposition < 0 || maxComposition > 100)) ||
    typeof value.sourceUrl !== 'string'
  ) {
    return null
  }
  if (minQuality !== null && (minQuality < 0 || minQuality > maxQuality)) return null
  if (minComposition !== null && maxComposition !== null && minComposition > maxComposition) {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    area: value.area,
    system: value.system,
    type: value.type,
    parentName: value.parentName,
    rockSpawnProbability,
    qualityThresholdProbability,
    combinedProbability,
    quantizationProbabilities,
    minQuality,
    maxQuality,
    minComposition,
    maxComposition,
    rockTypes,
    identitySource,
    sourceUrl: value.sourceUrl
  }
}

async function readLocationCache(cachePath: string): Promise<MiningLocationCache> {
  try {
    const payload: unknown = JSON.parse(await fs.readFile(cachePath, 'utf8'))
    if (!isRecord(payload) || !isRecord(payload.entries)) {
      throw new Error('The mining location cache has an unexpected shape.')
    }

    const entries: Record<string, MiningLocationCacheEntry> = {}
    for (const [materialId, value] of Object.entries(payload.entries)) {
      if (
        !isRecord(value) ||
        typeof value.savedAt !== 'string' ||
        !Array.isArray(value.locations)
      ) {
        throw new Error(`The cached mining locations for "${materialId}" are invalid.`)
      }
      const locations: MiningLocationRecommendation[] = []
      for (const location of value.locations) {
        const parsed = parseCachedRecommendation(location)
        if (!parsed) {
          throw new Error(`The cached mining locations for "${materialId}" are invalid.`)
        }
        locations.push(parsed)
      }
      entries[materialId] = {
        savedAt: value.savedAt,
        qualityThreshold:
          typeof value.qualityThreshold === 'number' &&
          Number.isSafeInteger(value.qualityThreshold) &&
          value.qualityThreshold >= 0 &&
          value.qualityThreshold <= 1_000
            ? value.qualityThreshold
            : DEFAULT_MINING_QUALITY_THRESHOLD,
        locations,
        // Legacy cache entries predate the local-catalog pipeline, so they were always Wiki-sourced.
        source: value.source === 'game' ? 'game' : 'wiki'
      }
    }
    return { entries }
  } catch (error) {
    if (isRecord(error) && 'code' in error && error.code === 'ENOENT') {
      return { entries: {} }
    }
    throw error
  }
}

async function writeLocationCacheEntry(
  cachePath: string,
  materialId: string,
  entry: MiningLocationCacheEntry,
  shouldWrite: () => boolean
): Promise<void> {
  const write = async (): Promise<void> => {
    if (!shouldWrite()) return
    const cache = await readLocationCache(cachePath)
    if (!shouldWrite()) return
    const legacyEntry = cache.entries[materialId]
    if (legacyEntry) {
      const legacyKey = locationCacheEntryKey(materialId, legacyEntry.qualityThreshold)
      cache.entries[legacyKey] ??= legacyEntry
      delete cache.entries[materialId]
    }
    cache.entries[locationCacheEntryKey(materialId, entry.qualityThreshold)] = entry
    await fs.mkdir(dirname(cachePath), { recursive: true })
    const temporaryPath = `${cachePath}.tmp`
    await fs.writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
    if (!shouldWrite()) {
      await fs.rm(temporaryPath, { force: true })
      return
    }
    await fs.rename(temporaryPath, cachePath)
  }

  const previous = cacheWriteQueues.get(cachePath) ?? Promise.resolve()
  const current = previous.then(write, write)
  cacheWriteQueues.set(cachePath, current)
  try {
    await current
  } finally {
    if (cacheWriteQueues.get(cachePath) === current) cacheWriteQueues.delete(cachePath)
  }
}

/**
 * Loads mining-site recommendations for one material, preferring the installed game archive.
 *
 * - When `catalogMaterialId` is set and a `catalog` is supplied, every value
 *   (group/relative probability, quality, composition, area modifiers) comes from the local
 *   catalog; the Wiki commodity-detail endpoint is only ever consulted to enrich the name of
 *   structurally unresolved real ship-mining providers, and never overrides local numbers.
 * - Otherwise, behavior is unchanged from before this layer: full Wiki fetch with cache fallback.
 */
export async function loadMiningLocations(
  cachePath: string,
  material: MiningMaterial,
  catalog: MiningCatalog | null = null,
  catalogMaterialId: string | null = null,
  qualityThreshold = DEFAULT_MINING_QUALITY_THRESHOLD,
  shouldWriteCache: () => boolean = () => true
): Promise<MiningLocationResult> {
  if (catalogMaterialId && catalog) {
    return loadLocalMiningLocations(
      cachePath,
      material,
      catalog,
      catalogMaterialId,
      qualityThreshold,
      shouldWriteCache
    )
  }
  return loadWikiMiningLocations(cachePath, material, qualityThreshold, shouldWriteCache)
}

async function loadLocalMiningLocations(
  cachePath: string,
  material: MiningMaterial,
  catalog: MiningCatalog,
  catalogMaterialId: string,
  qualityThreshold: number,
  shouldWriteCache: () => boolean
): Promise<MiningLocationResult> {
  try {
    const baseline = buildLocalMiningLocations(
      catalog,
      material,
      catalogMaterialId,
      new Map(),
      qualityThreshold
    )
    const hasUnresolvedProviders = baseline.some(
      (entry) => entry.identitySource === 'game' && entry.id.startsWith('provider:')
    )

    let locations = baseline
    let enrichmentWarning: string | null = null
    if (hasUnresolvedProviders) {
      try {
        const identities = await fetchWikiProviderIdentities(material)
        locations = buildLocalMiningLocations(
          catalog,
          material,
          catalogMaterialId,
          identities,
          qualityThreshold
        )
      } catch (enrichError) {
        const enrichMessage =
          enrichError instanceof Error ? enrichError.message : String(enrichError)
        enrichmentWarning = `Location-name enrichment unavailable: ${enrichMessage}`
      }
    }

    const updatedAt = new Date().toISOString()
    await writeLocationCacheEntry(
      cachePath,
      material.id,
      {
        savedAt: updatedAt,
        qualityThreshold,
        locations,
        source: 'game'
      },
      shouldWriteCache
    )
    return {
      materialId: material.id,
      qualityThreshold,
      locations,
      state: 'game',
      message: enrichmentWarning
        ? `Installed game mining data. ${enrichmentWarning}`
        : 'Installed game mining data',
      updatedAt
    }
  } catch (gameError) {
    const gameMessage = gameError instanceof Error ? gameError.message : String(gameError)
    const source: MiningLocationSourceState = 'game-cached'
    try {
      const cached = getLocationCacheEntry(
        await readLocationCache(cachePath),
        material.id,
        qualityThreshold
      )
      if (cached) {
        return {
          materialId: material.id,
          qualityThreshold,
          locations: cached.locations,
          state: cached.source === 'game' ? source : 'cached',
          message: `Using cached mining site data. ${gameMessage}`,
          updatedAt: cached.savedAt
        }
      }
    } catch (cacheError) {
      const cacheMessage = cacheError instanceof Error ? cacheError.message : String(cacheError)
      throw new Error(
        `Mining locations are unavailable. ${gameMessage} Cache error: ${cacheMessage}`
      )
    }

    throw new Error(`Mining locations are unavailable and no cached result exists. ${gameMessage}`)
  }
}

async function loadWikiMiningLocations(
  cachePath: string,
  material: MiningMaterial,
  qualityThreshold: number,
  shouldWriteCache: () => boolean
): Promise<MiningLocationResult> {
  try {
    const locations = await fetchLiveMiningLocations(material, qualityThreshold)
    const updatedAt = new Date().toISOString()
    await writeLocationCacheEntry(
      cachePath,
      material.id,
      {
        savedAt: updatedAt,
        qualityThreshold,
        locations,
        source: 'wiki'
      },
      shouldWriteCache
    )
    return {
      materialId: material.id,
      qualityThreshold,
      locations,
      state: 'live',
      message: 'Live mining quality estimates from Star Citizen Wiki',
      updatedAt
    }
  } catch (liveError) {
    const liveMessage = liveError instanceof Error ? liveError.message : String(liveError)
    try {
      const cached = getLocationCacheEntry(
        await readLocationCache(cachePath),
        material.id,
        qualityThreshold
      )
      if (cached) {
        return {
          materialId: material.id,
          qualityThreshold,
          locations: cached.locations,
          state: 'cached',
          message: `Using cached mining quality estimates. ${liveMessage}`,
          updatedAt: cached.savedAt
        }
      }
    } catch (cacheError) {
      const cacheMessage = cacheError instanceof Error ? cacheError.message : String(cacheError)
      throw new Error(
        `Mining locations are unavailable. ${liveMessage} Cache error: ${cacheMessage}`
      )
    }

    throw new Error(`Mining locations are unavailable and no cached result exists. ${liveMessage}`)
  }
}
