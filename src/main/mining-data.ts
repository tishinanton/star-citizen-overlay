import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

import type { MiningDataStatus, MiningMaterial, MiningMethod } from '../shared/contracts'
import {
  getGameArchiveFingerprint,
  inferCanonicalRecord,
  methodSlug,
  GAME_COMMODITY_IDS,
  METHOD_ORDER,
  PRIMARY_METHOD_ORDER,
  type GameDataArchive,
  type MiningMaterialMetadata
} from './game-data'
import { loadMiningCatalog, type MiningCatalog, type MiningCompositionPart } from './mining-catalog'

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
  miningCatalogCachePath: string
  extractorPath: string
  gameDataArchive: GameDataArchive | null
  forceRefresh?: boolean
}

export interface MiningDataResult {
  materials: MiningMaterial[]
  status: MiningDataStatus
  /**
   * The full local catalog when the game path produced one, so callers (main/index.ts) can reuse
   * it for the mining-sites pipeline without triggering a second extraction/cache read.
   */
  catalog: MiningCatalog | null
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
    catalogMaterialId: null,
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
    catalogMaterialId: null,
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

// --- Local-catalog material identity (installed game data path) -----------------------------

function dominantCompositionPart(
  composition: readonly MiningCompositionPart[]
): MiningCompositionPart | null {
  if (composition.length === 0) return null
  return [...composition].sort(
    (left, right) =>
      right.maxPercentage - left.maxPercentage || right.minPercentage - left.minPercentage
  )[0]
}

interface CanonicalCatalogRecord {
  key: string
  method: MiningMethod
  signature: number
  catalogMaterialId: string
}

interface GroupedCatalogSignature {
  key: string
  signature: number
  methods: MiningMethod[]
  catalogMaterialId: string
}

/**
 * Builds every `MiningMaterial` the installed game archive can supply, entirely from the local
 * `MiningCatalog` - no Wiki commodity-list call. Reuses the same canonical-record regex
 * (`inferCanonicalRecord`) the pre-layer-2 signature-only path used, but resolves each entity's
 * material identity directly from its own composition (the catalog's own cross-referenced
 * `MiningCompositionPart.materialId`) instead of matching Wiki metadata after the fact. Throws
 * when a canonical key's variants disagree on signature or material identity, since that would
 * indicate a broken assumption rather than something safe to silently drop or guess at.
 */
export function buildMaterialsFromCatalog(catalog: MiningCatalog): MiningMaterial[] {
  const materialsById = new Map(catalog.materials.map((material) => [material.id, material]))

  const byMethod = new Map<string, CanonicalCatalogRecord>()
  for (const entity of catalog.entities) {
    const canonical = inferCanonicalRecord(entity.path)
    if (!canonical) continue // non-canonical/template records, same skip as the legacy signature path

    const dominant = dominantCompositionPart(entity.composition)
    if (!dominant) {
      throw new Error(
        `Mineable entity '${entity.key}' has no usable composition to resolve a material identity.`
      )
    }
    const catalogMaterial = materialsById.get(dominant.materialId)
    if (!catalogMaterial) {
      throw new Error(
        `Mineable entity '${entity.key}' references an unresolved material identifier.`
      )
    }

    const method: MiningMethod = entity.method
    const methodKey = `${canonical.key}:${method}`
    const existing = byMethod.get(methodKey)
    if (existing) {
      if (existing.signature !== entity.signature) {
        throw new Error(`Conflicting ${method} signatures were found for ${canonical.key}.`)
      }
      if (existing.catalogMaterialId !== catalogMaterial.id) {
        throw new Error(
          `Mineable entity variants for '${canonical.key}' (${method}) resolve to different materials.`
        )
      }
      continue
    }
    byMethod.set(methodKey, {
      key: canonical.key,
      method,
      signature: entity.signature,
      catalogMaterialId: catalogMaterial.id
    })
  }

  const grouped = new Map<string, GroupedCatalogSignature>()
  for (const record of byMethod.values()) {
    const signatureKey = `${record.key}:${record.signature}`
    const existing = grouped.get(signatureKey)
    if (existing) {
      if (!existing.methods.includes(record.method)) existing.methods.push(record.method)
    } else {
      grouped.set(signatureKey, {
        key: record.key,
        signature: record.signature,
        methods: [record.method],
        catalogMaterialId: record.catalogMaterialId
      })
    }
  }

  const bySignatureKey = [...grouped.values()].map((entry) => ({
    ...entry,
    methods: [...entry.methods].sort((left, right) => METHOD_ORDER[left] - METHOD_ORDER[right])
  }))
  const signaturesByKey = new Map<string, GroupedCatalogSignature[]>()
  for (const entry of bySignatureKey) {
    const list = signaturesByKey.get(entry.key)
    if (list) {
      list.push(entry)
    } else {
      signaturesByKey.set(entry.key, [entry])
    }
  }

  const materials: MiningMaterial[] = []
  for (const [key, groups] of signaturesByKey) {
    const catalogMaterial = materialsById.get(groups[0].catalogMaterialId)
    if (!catalogMaterial) {
      throw new Error(`Mining material key '${key}' resolved to an unknown catalog material.`)
    }

    // Prefer the existing Wiki-slug mapping for materials already known to the Wiki, so ids stay
    // stable across the upgrade; fall back to the catalog's own slug for materials with no
    // existing mapping.
    const commodityId = GAME_COMMODITY_IDS[key] ?? catalogMaterial.slug
    const baseName = catalogMaterial.name
    const sourceUrl = `https://api.star-citizen.wiki/api/commodities/${encodeURIComponent(commodityId)}`

    const sortedGroups = [...groups].sort(
      (left, right) =>
        PRIMARY_METHOD_ORDER[left.methods[0]] - PRIMARY_METHOD_ORDER[right.methods[0]]
    )

    sortedGroups.forEach((signature, index) => {
      const hasVariants = sortedGroups.length > 1
      const methodLabel = signature.methods.join(' / ')
      materials.push({
        id:
          index === 0
            ? commodityId
            : `${commodityId}--${signature.methods.map(methodSlug).join('-')}`,
        commodityId,
        name: hasVariants ? `${baseName} (${methodLabel})` : baseName,
        displayName: hasVariants ? `${baseName} (${methodLabel})` : baseName,
        signature: signature.signature,
        methods: [...signature.methods],
        catalogMaterialId: catalogMaterial.id,
        sourceUrl
      })
    })
  }

  const ids = new Set(materials.map((material) => material.id))
  if (ids.size !== materials.length) {
    throw new Error('Installed game mining catalog produced duplicate material identifiers.')
  }

  return materials
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
    typeof value.sourceUrl !== 'string' ||
    (value.catalogMaterialId !== undefined &&
      value.catalogMaterialId !== null &&
      typeof value.catalogMaterialId !== 'string')
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
    catalogMaterialId: typeof value.catalogMaterialId === 'string' ? value.catalogMaterialId : null,
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

      // Always resolve through the local catalog (which has its own fingerprint/channel cache and
      // is normally near-instant on a hit) rather than short-circuiting on the older
      // mining-signatures.json cache alone: the mining-sites pipeline needs the full `MiningCatalog`
      // object, not just the derived material list, so skipping this call would force a second,
      // duplicate extraction the first time a Sites request comes in.
      const { catalog, cacheWarning } = await loadMiningCatalog({
        cachePath: options.miningCatalogCachePath,
        extractorPath: options.extractorPath,
        archivePath: options.gameDataArchive.path,
        archiveFingerprint,
        channel: options.gameDataArchive.channel,
        forceRefresh: options.forceRefresh
      })

      const materials = sortMaterials(buildMaterialsFromCatalog(catalog))
      const updatedAt = await writeCache(options.cachePath, materials, {
        kind: 'game',
        archiveFingerprint,
        channel: options.gameDataArchive.channel
      })
      return {
        materials,
        catalog,
        status: {
          state: 'game',
          message: cacheWarning
            ? `Installed ${options.gameDataArchive.channel} game data. Catalog cache unavailable: ${cacheWarning}`
            : `Installed ${options.gameDataArchive.channel} game data`,
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
      catalog: null,
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
        catalog: null,
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
      catalog: null,
      status: {
        state: 'fallback',
        message:
          `Using bundled signatures. ${gameError ?? ''} ${liveMessage}${cacheMessage}`.trim(),
        updatedAt: null
      }
    }
  }
}
