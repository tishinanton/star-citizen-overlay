import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

import {
  HIGH_QUALITY_THRESHOLD,
  MAX_RECOMMENDED_MINING_LOCATIONS,
  type MiningLocationRecommendation,
  type MiningLocationResult,
  type MiningMaterial
} from '../shared/contracts'

const COMMODITY_URL = 'https://api.star-citizen.wiki/api/commodities'
const cacheWriteQueues = new Map<string, Promise<void>>()

interface MiningLocationCache {
  entries: Record<string, MiningLocationCacheEntry>
}

interface MiningLocationCacheEntry {
  savedAt: string
  locations: MiningLocationRecommendation[]
}

interface DepositContribution {
  groupName: string
  groupProbability: number
  relativeProbability: number
  highQualityProbability: number
  maxQuality: number
  maxComposition: number | null
  areaModifiers: Map<string, number>
}

interface AreaCandidate {
  name: string | null
  globalModifier: number
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

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value))
}

// Abramowitz and Stegun's approximation keeps the quality estimate dependency-free.
function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value) / Math.sqrt(2)
  const t = 1 / (1 + 0.3275911 * x)
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)

  return 0.5 * (1 + sign * erf)
}

export function estimateHighQualityProbability(
  qualityMin: number,
  qualityMax: number,
  qualityMean: number | null,
  qualityStdDev: number | null,
  threshold = HIGH_QUALITY_THRESHOLD
): number {
  if (
    !Number.isFinite(qualityMin) ||
    !Number.isFinite(qualityMax) ||
    qualityMax < qualityMin ||
    !Number.isFinite(threshold)
  ) {
    return 0
  }
  if (qualityMax < threshold) return 0
  if (qualityMin >= threshold) return 1

  if (
    qualityMean === null ||
    qualityStdDev === null ||
    !Number.isFinite(qualityMean) ||
    !Number.isFinite(qualityStdDev) ||
    qualityStdDev <= 0
  ) {
    return clampProbability((qualityMax - threshold) / (qualityMax - qualityMin))
  }

  const lowerCdf = normalCdf((qualityMin - qualityMean) / qualityStdDev)
  const upperCdf = normalCdf((qualityMax - qualityMean) / qualityStdDev)
  const thresholdCdf = normalCdf((threshold - qualityMean) / qualityStdDev)
  const rangeProbability = upperCdf - lowerCdf

  if (rangeProbability <= Number.EPSILON) {
    return clampProbability((qualityMax - threshold) / (qualityMax - qualityMin))
  }

  return clampProbability((upperCdf - thresholdCdf) / rangeProbability)
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

function parseDepositContribution(
  value: unknown,
  commodityUuid: string
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
  let groupProbability = 0
  let relativeProbability = 0
  let maxQuality = 0
  let maxComposition: number | null = null

  for (const material of targetMaterials) {
    const qualityMin = finiteNumber(material.quality_min)
    const qualityMax = finiteNumber(material.quality_max)
    if (qualityMin === null || qualityMax === null) continue

    const qualityProbability = estimateHighQualityProbability(
      qualityMin,
      qualityMax,
      finiteNumber(material.quality_mean),
      finiteNumber(material.quality_stddev)
    )
    noHighQualityProbability *= 1 - qualityProbability
    maxQuality = Math.max(maxQuality, qualityMax)

    const materialGroupProbability = probability(material.group_probability)
    if (materialGroupProbability !== null) {
      groupProbability = Math.max(groupProbability, materialGroupProbability)
    }
    const materialRelativeProbability = probability(material.relative_probability)
    if (materialRelativeProbability !== null) {
      relativeProbability = Math.max(relativeProbability, materialRelativeProbability)
    }
    const materialMaxComposition = finiteNumber(material.max_percentage)
    if (materialMaxComposition !== null) {
      maxComposition = Math.max(maxComposition ?? 0, materialMaxComposition)
    }
  }

  if (groupProbability === 0 || relativeProbability === 0 || maxQuality === 0) return null

  return {
    groupName: typeof value.group_name === 'string' ? value.group_name : 'mineable',
    groupProbability,
    relativeProbability,
    highQualityProbability: 1 - noHighQualityProbability,
    maxQuality,
    maxComposition,
    areaModifiers: parseAreaModifiers(value.area_exceptions)
  }
}

function scoreContributions(contributions: DepositContribution[], area: AreaCandidate): number {
  const groups = new Map<string, { groupProbability: number; relativeChance: number }>()

  for (const contribution of contributions) {
    const areaModifier =
      area.name === null ? 1 : (contribution.areaModifiers.get(area.name) ?? area.globalModifier)
    const current = groups.get(contribution.groupName) ?? {
      groupProbability: 0,
      relativeChance: 0
    }
    current.groupProbability = Math.max(current.groupProbability, contribution.groupProbability)
    current.relativeChance +=
      contribution.relativeProbability * contribution.highQualityProbability * areaModifier
    groups.set(contribution.groupName, current)
  }

  let noHighQualityProbability = 1
  for (const group of groups.values()) {
    const groupChance = group.groupProbability * clampProbability(group.relativeChance)
    noHighQualityProbability *= 1 - clampProbability(groupChance)
  }
  return 1 - noHighQualityProbability
}

function parseLocation(value: unknown, commodityUuid: string): MiningLocationRecommendation | null {
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
    .map((resource) => parseDepositContribution(resource, commodityUuid))
    .filter((entry): entry is DepositContribution => entry !== null)
  if (contributions.length === 0) return null

  let bestArea: AreaCandidate = { name: null, globalModifier: 1 }
  let highQualityProbability = scoreContributions(contributions, bestArea)
  for (const area of parseAreaCandidates(value.areas).slice(1)) {
    const areaProbability = scoreContributions(contributions, area)
    if (areaProbability > highQualityProbability) {
      bestArea = area
      highQualityProbability = areaProbability
    }
  }
  if (highQualityProbability <= 0) return null

  return {
    id,
    name,
    area: bestArea.name,
    system,
    type,
    parentName: typeof value.parent_name === 'string' ? value.parent_name : null,
    highQualityProbability,
    maxQuality: Math.max(...contributions.map((contribution) => contribution.maxQuality)),
    maxComposition: contributions.reduce<number | null>(
      (maximum, contribution) =>
        contribution.maxComposition === null
          ? maximum
          : Math.max(maximum ?? 0, contribution.maxComposition),
      null
    ),
    sourceUrl:
      typeof value.link === 'string'
        ? value.link
        : `https://api.star-citizen.wiki/api/locations/${id}`
  }
}

export function parseMiningLocationRecommendations(
  payload: unknown,
  materialId: string
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
    .map((location) => parseLocation(location, commodityUuid))
    .filter((location): location is MiningLocationRecommendation => location !== null)
    .sort(
      (left, right) =>
        right.highQualityProbability - left.highQualityProbability ||
        right.maxQuality - left.maxQuality ||
        (right.maxComposition ?? 0) - (left.maxComposition ?? 0) ||
        left.name.localeCompare(right.name)
    )
    .slice(0, MAX_RECOMMENDED_MINING_LOCATIONS)
}

async function fetchLiveMiningLocations(
  material: MiningMaterial
): Promise<MiningLocationRecommendation[]> {
  const response = await fetch(`${COMMODITY_URL}/${encodeURIComponent(material.id)}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Rockfall/0.1 (Star Citizen mining overlay)'
    },
    signal: AbortSignal.timeout(12_000)
  })

  if (!response.ok) {
    throw new Error(`Star Citizen Wiki API returned HTTP ${response.status}.`)
  }

  return parseMiningLocationRecommendations(await response.json(), material.id)
}

function parseCachedRecommendation(value: unknown): MiningLocationRecommendation | null {
  if (!isRecord(value)) return null

  const highQualityProbability = probability(value.highQualityProbability)
  const maxQuality = finiteNumber(value.maxQuality)
  const maxComposition = value.maxComposition === null ? null : finiteNumber(value.maxComposition)
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    (value.area !== null && typeof value.area !== 'string') ||
    typeof value.system !== 'string' ||
    typeof value.type !== 'string' ||
    (value.parentName !== null && typeof value.parentName !== 'string') ||
    highQualityProbability === null ||
    maxQuality === null ||
    maxQuality < 0 ||
    maxQuality > 1_000 ||
    (value.maxComposition !== null && maxComposition === null) ||
    (maxComposition !== null && (maxComposition < 0 || maxComposition > 100)) ||
    typeof value.sourceUrl !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    area: value.area,
    system: value.system,
    type: value.type,
    parentName: value.parentName,
    highQualityProbability,
    maxQuality,
    maxComposition,
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
        locations
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
  entry: MiningLocationCacheEntry
): Promise<void> {
  const write = async (): Promise<void> => {
    const cache = await readLocationCache(cachePath)
    cache.entries[materialId] = entry
    await fs.mkdir(dirname(cachePath), { recursive: true })
    const temporaryPath = `${cachePath}.tmp`
    await fs.writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
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

export async function loadMiningLocations(
  cachePath: string,
  material: MiningMaterial
): Promise<MiningLocationResult> {
  try {
    const locations = await fetchLiveMiningLocations(material)
    const updatedAt = new Date().toISOString()
    await writeLocationCacheEntry(cachePath, material.id, { savedAt: updatedAt, locations })
    return {
      materialId: material.id,
      locations,
      state: 'live',
      message: 'Live mining quality estimates from Star Citizen Wiki',
      updatedAt
    }
  } catch (liveError) {
    const liveMessage = liveError instanceof Error ? liveError.message : String(liveError)
    try {
      const cached = (await readLocationCache(cachePath)).entries[material.id]
      if (cached) {
        return {
          materialId: material.id,
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
