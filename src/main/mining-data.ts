import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

import type { MiningDataStatus, MiningMaterial, MiningMethod } from '../shared/contracts'

const COMMODITIES_URL =
  'https://api.star-citizen.wiki/api/commodities?filter%5Bmineable%5D=true&filter%5Bkind%5D=mineable&page%5Bsize%5D=200'

const FALLBACK_MATERIALS: MiningMaterial[] = [
  fallback('agricium-ore', 'Agricium (Ore)', 4000, ['Ship']),
  fallback('laranite-raw', 'Laranite (Raw)', 4750, ['Ship']),
  fallback('lindinium-ore', 'Lindinium (Ore)', 3400, ['Ship']),
  fallback('riccite-ore', 'Riccite (Ore)', 4700, ['Ship']),
  fallback('savrilium-ore', 'Savrilium (Ore)', 3200, ['Ship']),
  fallback('titanium-ore', 'Titanium (Ore)', 4700, ['Ship']),
  fallback('torite-ore', 'Torite (Ore)', 3200, ['Ship']),
  fallback('hadanite', 'Hadanite', 3000, ['FPS']),
  fallback('janalite', 'Janalite', 4000, ['FPS']),
  fallback('beradom', 'Beradom', 4000, ['Ground Vehicle']),
  fallback('feynmaline', 'Feynmaline', 4000, ['Ground Vehicle']),
  fallback('glacosite', 'Glacosite', 4000, ['Ground Vehicle'])
]

interface MiningCache {
  savedAt: string
  materials: MiningMaterial[]
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

function parseCommodity(value: unknown): MiningMaterial | null {
  if (!isRecord(value)) return null

  const id = typeof value.slug === 'string' ? value.slug.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const displayName =
    typeof value.display_name === 'string' && value.display_name.trim()
      ? value.display_name.trim()
      : name
  const signature = value.signature

  if (
    !id ||
    !name ||
    typeof signature !== 'number' ||
    !Number.isFinite(signature) ||
    signature <= 0
  ) {
    return null
  }

  const methods = Array.isArray(value.methods)
    ? value.methods.map(parseMethod).filter((method): method is MiningMethod => method !== null)
    : []

  if (value.has_ship_mineables === true && !methods.includes('Ship')) methods.push('Ship')
  if (value.has_ground_vehicle_mineables === true && !methods.includes('Ground Vehicle')) {
    methods.push('Ground Vehicle')
  }
  if (value.has_fps_mineables === true && !methods.includes('FPS')) methods.push('FPS')

  return {
    id,
    name,
    displayName,
    signature,
    methods: methods.length > 0 ? methods : ['Unclassified'],
    sourceUrl:
      typeof value.link === 'string'
        ? value.link
        : `https://api.star-citizen.wiki/api/commodities/${id}`
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

async function fetchLiveMaterials(): Promise<MiningMaterial[]> {
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

  const materials = sortMaterials(
    payload.data.map(parseCommodity).filter(Boolean) as MiningMaterial[]
  )
  if (materials.length === 0) {
    throw new Error('Star Citizen Wiki API returned no mineable commodities with signatures.')
  }

  return materials
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

    const materials = payload.materials.map(parseCachedMaterial).filter(Boolean) as MiningMaterial[]
    return materials.length > 0 ? { savedAt: payload.savedAt, materials } : null
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
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
    !Number.isFinite(value.signature) ||
    value.signature <= 0 ||
    typeof value.sourceUrl !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    displayName: value.displayName,
    signature: value.signature,
    methods: methods.length > 0 ? methods : ['Unclassified'],
    sourceUrl: value.sourceUrl
  }
}

async function writeCache(cachePath: string, materials: MiningMaterial[]): Promise<string> {
  const savedAt = new Date().toISOString()
  await fs.mkdir(dirname(cachePath), { recursive: true })
  const temporaryPath = `${cachePath}.tmp`
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify({ savedAt, materials } satisfies MiningCache, null, 2)}\n`,
    'utf8'
  )
  await fs.rename(temporaryPath, cachePath)
  return savedAt
}

export async function loadMiningData(cachePath: string): Promise<MiningDataResult> {
  try {
    const materials = await fetchLiveMaterials()
    const updatedAt = await writeCache(cachePath, materials)
    return {
      materials,
      status: {
        state: 'live',
        message: 'Live signatures from Star Citizen Wiki',
        updatedAt
      }
    }
  } catch (liveError) {
    const liveMessage = liveError instanceof Error ? liveError.message : String(liveError)

    try {
      const cached = await readCache(cachePath)
      if (cached) {
        return {
          materials: cached.materials,
          status: {
            state: 'cached',
            message: `Using cached signatures. ${liveMessage}`,
            updatedAt: cached.savedAt
          }
        }
      }
    } catch (cacheError) {
      const cacheMessage = cacheError instanceof Error ? cacheError.message : String(cacheError)
      return {
        materials: FALLBACK_MATERIALS,
        status: {
          state: 'fallback',
          message: `Live and cached data unavailable. ${liveMessage} Cache error: ${cacheMessage}`,
          updatedAt: null
        }
      }
    }

    return {
      materials: FALLBACK_MATERIALS,
      status: {
        state: 'fallback',
        message: `Using bundled signatures. ${liveMessage}`,
        updatedAt: null
      }
    }
  }
}
