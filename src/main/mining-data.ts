import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

import type { MiningDataStatus, MiningMaterial, MiningMethod } from '../shared/contracts'
import {
  extractGameSignatures,
  getGameArchiveFingerprint,
  mergeGameSignatures,
  type GameDataArchive,
  type MiningMaterialMetadata
} from './game-data'

const COMMODITIES_URL =
  'https://api.star-citizen.wiki/api/commodities?filter%5Bmineable%5D=true&filter%5Bkind%5D=mineable&page%5Bsize%5D=200'
const MINING_CACHE_VERSION = 2

const FALLBACK_MATERIALS: MiningMaterial[] = [
  fallback('agricium-ore', 'Agricium (Ore)', 3885, ['Ship']),
  fallback('laranite-raw', 'Laranite (Raw)', 3825, ['Ship']),
  fallback('lindinium-ore', 'Lindinium (Ore)', 3400, ['Ship']),
  fallback('riccite-ore', 'Riccite (Ore)', 3385, ['Ship']),
  fallback('savrilium-ore', 'Savrilium (Ore)', 3200, ['Ship']),
  fallback('titanium-ore', 'Titanium (Ore)', 3855, ['Ship']),
  fallback('torite-ore', 'Torite (Ore)', 3900, ['Ship']),
  fallback('hadanite', 'Hadanite', 3000, ['FPS']),
  fallback('janalite', 'Janalite', 3000, ['FPS']),
  fallback('beradom', 'Beradom', 4000, ['Ground Vehicle']),
  fallback('feynmaline', 'Feynmaline', 4000, ['Ground Vehicle']),
  fallback('glacosite', 'Glacosite', 4000, ['Ground Vehicle'])
]

type MiningCacheSource =
  | {
      kind: 'game'
      archiveFingerprint: string
      channel: string
    }
  | {
      kind: 'api'
    }

interface MiningCache {
  schemaVersion: number
  savedAt: string
  materials: MiningMaterial[]
  source: MiningCacheSource | null
}

export interface MiningDataOptions {
  cachePath: string
  extractorPath: string
  gameDataArchive: GameDataArchive | null
}

export interface MiningDataResult {
  materials: MiningMaterial[]
  status: MiningDataStatus
}

function fallback(
  id: string,
  name: string,
  signature: number,
  methods: MiningMethod[]
): MiningMaterial {
  return {
    id,
    commodityId: id,
    name,
    displayName: name,
    signature,
    methods,
    sourceUrl: `https://api.star-citizen.wiki/api/commodities/${id}`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseMethod(value: unknown): MiningMethod | null {
  if (value === 'Ship' || value === 'Ground Vehicle' || value === 'FPS') {
    return value
  }
  return null
}

function parseCommodityMetadata(value: unknown): MiningMaterialMetadata | null {
  if (!isRecord(value)) return null

  const id = typeof value.slug === 'string' ? value.slug.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const displayName =
    typeof value.display_name === 'string' && value.display_name.trim()
      ? value.display_name.trim()
      : name
  if (!id || !name) return null

  const methods = Array.isArray(value.methods)
    ? value.methods.map(parseMethod).filter((method): method is MiningMethod => method !== null)
    : []
  if (value.has_ship_mineables === true && !methods.includes('Ship')) methods.push('Ship')
  if (value.has_ground_vehicle_mineables === true && !methods.includes('Ground Vehicle')) {
    methods.push('Ground Vehicle')
  }
  if (value.has_fps_mineables === true && !methods.includes('FPS')) methods.push('FPS')

  const sourceSignature =
    typeof value.signature === 'number' &&
    Number.isSafeInteger(value.signature) &&
    value.signature > 0
      ? value.signature
      : null

  return {
    id,
    name,
    displayName,
    sourceSignature,
    methods,
    sourceUrl:
      typeof value.link === 'string'
        ? value.link
        : `https://api.star-citizen.wiki/api/commodities/${id}`
  }
}

function metadataToMaterial(metadata: MiningMaterialMetadata): MiningMaterial | null {
  if (metadata.sourceSignature === null) return null
  return {
    id: metadata.id,
    commodityId: metadata.id,
    name: metadata.name,
    displayName: metadata.displayName,
    signature: metadata.sourceSignature,
    methods: metadata.methods.length > 0 ? metadata.methods : ['Unclassified'],
    sourceUrl: metadata.sourceUrl
  }
}

function sortMaterials(materials: MiningMaterial[]): MiningMaterial[] {
  const methodOrder: Record<MiningMethod, number> = {
    Ship: 0,
    'Ground Vehicle': 1,
    FPS: 2,
    Unclassified: 3
  }

  return [...materials].sort((left, right) => {
    const methodDifference =
      Math.min(...left.methods.map((method) => methodOrder[method])) -
      Math.min(...right.methods.map((method) => methodOrder[method]))
    return methodDifference || left.name.localeCompare(right.name)
  })
}

async function fetchCommodityMetadata(): Promise<MiningMaterialMetadata[]> {
  const response = await fetch(COMMODITIES_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Rockfall/0.1 (Star Citizen mining overlay)'
    },
    signal: AbortSignal.timeout(12_000)
  })

  if (!response.ok) {
    throw new Error(`Star Citizen Wiki API returned HTTP ${response.status}.`)
  }

  const payload: unknown = await response.json()
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Star Citizen Wiki API returned an unexpected response shape.')
  }

  const metadata = payload.data
    .map(parseCommodityMetadata)
    .filter((entry): entry is MiningMaterialMetadata => entry !== null)
  if (metadata.length === 0) {
    throw new Error('Star Citizen Wiki API returned no mineable commodity metadata.')
  }
  return metadata
}

function parseCacheSource(value: unknown): MiningCacheSource | null {
  if (!isRecord(value)) return null
  if (value.kind === 'api') return { kind: 'api' }
  if (
    value.kind === 'game' &&
    typeof value.archiveFingerprint === 'string' &&
    value.archiveFingerprint.length > 0 &&
    typeof value.channel === 'string' &&
    value.channel.length > 0
  ) {
    return {
      kind: 'game',
      archiveFingerprint: value.archiveFingerprint,
      channel: value.channel
    }
  }
  return null
}

async function readCache(cachePath: string): Promise<MiningCache | null> {
  try {
    const payload: unknown = JSON.parse(await fs.readFile(cachePath, 'utf8'))
    if (
      !isRecord(payload) ||
      typeof payload.savedAt !== 'string' ||
      !Array.isArray(payload.materials)
    ) {
      return null
    }

    const materials = payload.materials
      .map(parseCachedMaterial)
      .filter((entry): entry is MiningMaterial => entry !== null)
    if (materials.length === 0) return null

    return {
      schemaVersion:
        typeof payload.schemaVersion === 'number' && Number.isInteger(payload.schemaVersion)
          ? payload.schemaVersion
          : 1,
      savedAt: payload.savedAt,
      materials,
      source: parseCacheSource(payload.source)
    }
  } catch (error) {
    if (isRecord(error) && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function parseCachedMaterial(value: unknown): MiningMaterial | null {
  if (!isRecord(value)) return null
  const methods = Array.isArray(value.methods)
    ? value.methods
        .map((method) => (method === 'Unclassified' ? method : parseMethod(method)))
        .filter((method): method is MiningMethod => method !== null)
    : []

  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.signature !== 'number' ||
    !Number.isSafeInteger(value.signature) ||
    value.signature <= 0 ||
    typeof value.sourceUrl !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    commodityId: typeof value.commodityId === 'string' ? value.commodityId : value.id,
    name: value.name,
    displayName: value.displayName,
    signature: value.signature,
    methods: methods.length > 0 ? methods : ['Unclassified'],
    sourceUrl: value.sourceUrl
  }
}

async function writeCache(
  cachePath: string,
  materials: MiningMaterial[],
  source: MiningCacheSource
): Promise<string> {
  const savedAt = new Date().toISOString()
  await fs.mkdir(dirname(cachePath), { recursive: true })
  const temporaryPath = `${cachePath}.tmp`
  const cache: MiningCache = {
    schemaVersion: MINING_CACHE_VERSION,
    savedAt,
    materials,
    source
  }
  await fs.writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  await fs.rename(temporaryPath, cachePath)
  return savedAt
}

function cachedMetadata(cache: MiningCache | null): MiningMaterialMetadata[] {
  if (!cache) return []
  const byCommodity = new Map<string, MiningMaterial>()
  for (const material of cache.materials) {
    const existing = byCommodity.get(material.commodityId)
    if (!existing || material.id === material.commodityId) {
      byCommodity.set(material.commodityId, material)
    }
  }
  return [...byCommodity.values()].map((material) => ({
    id: material.commodityId,
    name: material.name.replace(/ \((?:Ship|Ground Vehicle|FPS)(?: \/ [^)]+)?\)$/, ''),
    displayName: material.displayName.replace(
      / \((?:Ship|Ground Vehicle|FPS)(?: \/ [^)]+)?\)$/,
      ''
    ),
    sourceSignature: material.signature,
    methods: material.methods,
    sourceUrl: material.sourceUrl
  }))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function loadMiningData(options: MiningDataOptions): Promise<MiningDataResult> {
  let cache: MiningCache | null = null
  let cacheError: string | null = null
  try {
    cache = await readCache(options.cachePath)
  } catch (error) {
    cacheError = errorMessage(error)
  }

  const gameDataNotConfigured = options.gameDataArchive === null
  let gameError: string | null = null

  if (options.gameDataArchive) {
    try {
      const archiveFingerprint = await getGameArchiveFingerprint(options.gameDataArchive.path)
      if (
        cache?.schemaVersion === MINING_CACHE_VERSION &&
        cache.source?.kind === 'game' &&
        cache.source.archiveFingerprint === archiveFingerprint &&
        cache.source.channel === options.gameDataArchive.channel
      ) {
        return {
          materials: cache.materials,
          status: {
            state: 'game',
            message: `Installed ${cache.source.channel} game signatures`,
            updatedAt: cache.savedAt
          }
        }
      }

      const signatures = await extractGameSignatures(
        options.extractorPath,
        options.gameDataArchive.path
      )
      let metadata: MiningMaterialMetadata[]
      let metadataWarning: string | null = null
      try {
        metadata = await fetchCommodityMetadata()
      } catch (error) {
        metadataWarning = errorMessage(error)
        metadata = cachedMetadata(cache)
      }

      const materials = sortMaterials(mergeGameSignatures(signatures, metadata))
      const updatedAt = await writeCache(options.cachePath, materials, {
        kind: 'game',
        archiveFingerprint,
        channel: options.gameDataArchive.channel
      })
      return {
        materials,
        status: {
          state: 'game',
          message: metadataWarning
            ? `Installed ${options.gameDataArchive.channel} game signatures. Wiki metadata unavailable: ${metadataWarning}`
            : `Installed ${options.gameDataArchive.channel} game signatures`,
          updatedAt
        }
      }
    } catch (error) {
      gameError = errorMessage(error)
    }
  }

  try {
    const metadata = await fetchCommodityMetadata()
    const materials = sortMaterials(
      metadata.map(metadataToMaterial).filter((entry): entry is MiningMaterial => entry !== null)
    )
    if (materials.length === 0) {
      throw new Error('Star Citizen Wiki API returned no mineable commodities with signatures.')
    }
    const updatedAt = await writeCache(options.cachePath, materials, { kind: 'api' })
    return {
      materials,
      status: {
        state: 'live',
        message: gameError
          ? `Wiki signatures in use. ${gameError}`
          : gameDataNotConfigured
            ? 'Wiki signatures in use. Choose Game files to use installed data.'
            : 'Live signatures from Star Citizen Wiki',
        updatedAt
      }
    }
  } catch (liveError) {
    const liveMessage = errorMessage(liveError)
    if (cache) {
      return {
        materials: cache.materials,
        status: {
          state: 'cached',
          message: `Using cached signatures. ${gameError ?? ''} ${liveMessage}`.trim(),
          updatedAt: cache.savedAt
        }
      }
    }

    const cacheMessage = cacheError ? ` Cache error: ${cacheError}` : ''
    return {
      materials: FALLBACK_MATERIALS,
      status: {
        state: 'fallback',
        message:
          `Using bundled signatures. ${gameError ?? ''} ${liveMessage}${cacheMessage}`.trim(),
        updatedAt: null
      }
    }
  }
}
