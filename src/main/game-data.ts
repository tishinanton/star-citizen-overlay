import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'

import type { MiningMaterial, MiningMethod } from '../shared/contracts'

const execFileAsync = promisify(execFile)
const EXTRACTOR_SCHEMA_VERSION = 1
const PREFERENCE_SCHEMA_VERSION = 1
const MIN_CANONICAL_SIGNATURES = 20
const GAME_RECORD_PREFIX = 'libs/foundry/records/entities/mineable/'
const CHANNELS = ['LIVE', 'PTU', 'EPTU', 'TECH-PREVIEW', 'HOTFIX']
const METHOD_ORDER: Record<MiningMethod, number> = {
  Ship: 0,
  'Ground Vehicle': 1,
  FPS: 2,
  Unclassified: 3
}
const PRIMARY_METHOD_ORDER: Record<MiningMethod, number> = {
  Ship: 0,
  FPS: 1,
  'Ground Vehicle': 2,
  Unclassified: 3
}
const IGNORED_COMMODITY_TOKENS = new Set([
  'metal',
  'mineral',
  'nonmetal',
  'ore',
  'organic',
  'r',
  'raw',
  'rawminerals',
  'unrefinedores'
])
const GAME_COMMODITY_IDS: Readonly<Record<string, string>> = {
  agricium: 'agricium-ore',
  aluminum: 'aluminum-ore',
  aphorite: 'aphorite',
  aslarite: 'aslarite-raw',
  beradom: 'beradom',
  beryl: 'beryl-raw',
  bexalite: 'bexalite-raw',
  borase: 'borase-ore',
  carinite: 'carinite',
  copper: 'copper-ore',
  corundum: 'corundum-raw',
  dolivine: 'dolivine',
  feynmaline: 'feynmaline',
  glacosite: 'glacosite',
  gold: 'gold-ore',
  hadanite: 'hadanite',
  hephaestanite: 'hephaestanite-r',
  ice: 'raw-ice',
  iron: 'iron-ore',
  jaclium: 'jaclium-ore',
  janalite: 'janalite',
  laranite: 'laranite-raw',
  lindinium: 'lindinium-ore',
  ouratite: 'raw-ouratite',
  quantainium: 'quantainium-raw',
  quartz: 'quartz-raw',
  riccite: 'riccite-ore',
  sadaryx: 'sadaryx',
  saldynium: 'saldynium-ore',
  savrilium: 'savrilium-ore',
  silicon: 'raw-silicon',
  stileron: 'stileron-ore',
  taranite: 'taranite-raw',
  tin: 'tin-ore',
  titanium: 'titanium-ore',
  torite: 'torite-ore',
  tungsten: 'tungsten-ore'
}

export interface GameDataArchive {
  path: string
  channel: string
}

export interface GameDataPreferenceResult {
  preferredPath: string | null
  warning: string | null
}

export interface GameMaterialSignature {
  key: string
  signature: number
  methods: MiningMethod[]
}

export interface MiningMaterialMetadata {
  id: string
  name: string
  displayName: string
  sourceSignature: number | null
  methods: MiningMethod[]
  sourceUrl: string
}

interface GameDataPreference {
  schemaVersion: number
  archivePath: string
}

interface ExtractorRecord {
  recordPath: string
  signature: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function inferCanonicalRecord(recordPath: string): { key: string; method: MiningMethod } | null {
  const filename = recordPath
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.xml$/i, '')
    .toLowerCase()
  if (!filename) return null

  const shipMatch =
    /^mineablerock_(?:asteroid|surface)(?:common|uncommon|rare|epic|legendary)_([a-z0-9]+)(?:_rcd_(?:large|small))?$/.exec(
      filename
    )
  if (shipMatch && shipMatch[1] !== 'template') {
    return { key: shipMatch[1], method: 'Ship' }
  }

  const fpsMatch = /^mineablerock_fps_([a-z0-9]+)(?:_(?:large|small|pure_small))?$/.exec(filename)
  if (fpsMatch && fpsMatch[1] !== 'template') {
    return { key: fpsMatch[1], method: 'FPS' }
  }

  const groundMatch = /^mineablerock_groundvehicle_([a-z0-9]+)(?:_(?:large|small))?$/.exec(filename)
  if (groundMatch && groundMatch[1] !== 'template') {
    return { key: groundMatch[1], method: 'Ground Vehicle' }
  }

  return null
}

function parseExtractorRecord(value: unknown): ExtractorRecord | null {
  if (!isRecord(value)) return null
  if (
    typeof value.recordPath !== 'string' ||
    value.recordPath.length === 0 ||
    value.recordPath.length > 1_000 ||
    !value.recordPath.toLowerCase().startsWith(GAME_RECORD_PREFIX) ||
    typeof value.signature !== 'number' ||
    !Number.isSafeInteger(value.signature) ||
    value.signature <= 0
  ) {
    return null
  }

  return {
    recordPath: value.recordPath,
    signature: value.signature
  }
}

export function parseGameSignaturePayload(value: unknown): GameMaterialSignature[] {
  if (
    !isRecord(value) ||
    value.schemaVersion !== EXTRACTOR_SCHEMA_VERSION ||
    !Array.isArray(value.records) ||
    value.records.length === 0 ||
    value.records.length > 2_000
  ) {
    throw new TypeError('The game data extractor returned an unsupported response.')
  }

  const byMethod = new Map<string, { key: string; method: MiningMethod; signature: number }>()
  for (const candidate of value.records) {
    const record = parseExtractorRecord(candidate)
    if (!record) {
      throw new TypeError('The game data extractor returned an invalid signature record.')
    }

    const canonical = inferCanonicalRecord(record.recordPath)
    if (!canonical) continue

    const methodKey = `${canonical.key}:${canonical.method}`
    const existing = byMethod.get(methodKey)
    if (existing && existing.signature !== record.signature) {
      throw new Error(`Conflicting ${canonical.method} signatures were found for ${canonical.key}.`)
    }
    byMethod.set(methodKey, { ...canonical, signature: record.signature })
  }

  const grouped = new Map<string, GameMaterialSignature>()
  for (const record of byMethod.values()) {
    const signatureKey = `${record.key}:${record.signature}`
    const existing = grouped.get(signatureKey)
    if (existing) {
      if (!existing.methods.includes(record.method)) existing.methods.push(record.method)
    } else {
      grouped.set(signatureKey, {
        key: record.key,
        signature: record.signature,
        methods: [record.method]
      })
    }
  }

  const signatures = [...grouped.values()]
  if (
    signatures.length < MIN_CANONICAL_SIGNATURES ||
    !signatures.some((entry) => entry.methods.includes('Ship'))
  ) {
    throw new Error('The game data did not contain a complete set of current mining signatures.')
  }

  return signatures
    .map((entry) => ({
      ...entry,
      methods: [...entry.methods].sort((left, right) => METHOD_ORDER[left] - METHOD_ORDER[right])
    }))
    .sort(
      (left, right) =>
        METHOD_ORDER[left.methods[0]] - METHOD_ORDER[right.methods[0]] ||
        left.key.localeCompare(right.key) ||
        left.signature - right.signature
    )
}

export async function extractGameSignatures(
  extractorPath: string,
  archivePath: string
): Promise<GameMaterialSignature[]> {
  try {
    const { stdout } = await execFileAsync(extractorPath, [archivePath], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true
    })
    return parseGameSignaturePayload(JSON.parse(stdout) as unknown)
  } catch (error) {
    const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : ''
    const message = stderr || (error instanceof Error ? error.message : String(error))
    throw new Error(`Installed game signatures could not be extracted: ${message}`, {
      cause: error
    })
  }
}

export function normalizeCommodityKey(value: string): string {
  return value
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !IGNORED_COMMODITY_TOKENS.has(token))
    .join('')
}

function metadataKeys(metadata: MiningMaterialMetadata): string[] {
  return [...new Set([metadata.id, metadata.name, metadata.displayName].map(normalizeCommodityKey))]
}

function findMetadata(
  signature: GameMaterialSignature,
  metadata: readonly MiningMaterialMetadata[]
): MiningMaterialMetadata | null {
  const expectedId = GAME_COMMODITY_IDS[signature.key]
  const candidates = metadata.filter((entry) => metadataKeys(entry).includes(signature.key))
  return (
    candidates.sort((left, right) => {
      const score = (entry: MiningMaterialMetadata): number =>
        (entry.id === expectedId ? 100 : 0) +
        (entry.methods.some((method) => signature.methods.includes(method)) ? 10 : 0) +
        (entry.sourceSignature === signature.signature ? 5 : 0)
      return score(right) - score(left)
    })[0] ?? null
  )
}

function formatGameKey(key: string): string {
  return `${key.charAt(0).toUpperCase()}${key.slice(1)}`
}

function methodSlug(method: MiningMethod): string {
  return method.toLowerCase().replaceAll(' ', '-')
}

export function mergeGameSignatures(
  signatures: readonly GameMaterialSignature[],
  metadata: readonly MiningMaterialMetadata[]
): MiningMaterial[] {
  const signaturesByKey = Map.groupBy(signatures, (signature) => signature.key)
  const materials: MiningMaterial[] = []

  for (const [key, groups] of signaturesByKey) {
    const matchedMetadata = findMetadata(groups[0], metadata)
    const commodityId = matchedMetadata?.id ?? GAME_COMMODITY_IDS[key] ?? `game-${key}`
    const baseName = matchedMetadata?.name ?? formatGameKey(key)
    const baseDisplayName = matchedMetadata?.displayName ?? baseName
    const sourceUrl =
      matchedMetadata?.sourceUrl ??
      `https://api.star-citizen.wiki/api/commodities/${encodeURIComponent(commodityId)}`
    const sortedGroups = [...groups].sort((left, right) => {
      const leftMatchesSource = left.signature === matchedMetadata?.sourceSignature ? -1 : 0
      const rightMatchesSource = right.signature === matchedMetadata?.sourceSignature ? -1 : 0
      return (
        leftMatchesSource - rightMatchesSource ||
        PRIMARY_METHOD_ORDER[left.methods[0]] - PRIMARY_METHOD_ORDER[right.methods[0]]
      )
    })

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
        displayName: hasVariants ? `${baseDisplayName} (${methodLabel})` : baseDisplayName,
        signature: signature.signature,
        methods: [...signature.methods],
        sourceUrl
      })
    })
  }

  const ids = new Set(materials.map((material) => material.id))
  if (ids.size !== materials.length) {
    throw new Error('Installed game signatures produced duplicate material identifiers.')
  }

  return materials.sort(
    (left, right) =>
      METHOD_ORDER[left.methods[0]] - METHOD_ORDER[right.methods[0]] ||
      left.name.localeCompare(right.name)
  )
}

export async function loadGameDataPreference(
  preferencePath: string
): Promise<GameDataPreferenceResult> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(preferencePath, 'utf8'))
    if (
      !isRecord(value) ||
      value.schemaVersion !== PREFERENCE_SCHEMA_VERSION ||
      typeof value.archivePath !== 'string' ||
      value.archivePath.length === 0 ||
      value.archivePath.length > 4_000
    ) {
      throw new TypeError('The saved game data location is invalid.')
    }
    return { preferredPath: value.archivePath, warning: null }
  } catch (error) {
    if (isMissingFileError(error)) return { preferredPath: null, warning: null }
    const message = error instanceof Error ? error.message : String(error)
    return {
      preferredPath: null,
      warning: `The saved game data location could not be loaded: ${message}`
    }
  }
}

export async function saveGameDataPreference(
  preferencePath: string,
  archivePath: string
): Promise<void> {
  await fs.mkdir(dirname(preferencePath), { recursive: true })
  const temporaryPath = `${preferencePath}.tmp`
  const preference: GameDataPreference = {
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    archivePath
  }
  await fs.writeFile(temporaryPath, `${JSON.stringify(preference, null, 2)}\n`, 'utf8')
  await fs.rename(temporaryPath, preferencePath)
}

export async function validateGameDataArchive(archivePath: string): Promise<GameDataArchive> {
  if (extname(archivePath).toLowerCase() !== '.p4k') {
    throw new TypeError('Select the Data.p4k file from a Star Citizen game channel.')
  }
  const stats = await fs.stat(archivePath)
  if (!stats.isFile()) {
    throw new TypeError('The selected game data location is not a file.')
  }
  return {
    path: archivePath,
    channel: basename(dirname(archivePath)) || 'game'
  }
}

export function getDefaultGameDataCandidates(): string[] {
  const installRoots = new Set<string>()
  if (process.env.ProgramFiles) {
    installRoots.add(join(process.env.ProgramFiles, 'Roberts Space Industries', 'StarCitizen'))
  }

  for (let code = 'C'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`
    installRoots.add(join(drive, 'Program Files', 'Roberts Space Industries', 'StarCitizen'))
    installRoots.add(join(drive, 'Roberts Space Industries', 'StarCitizen'))
    installRoots.add(join(drive, 'Games', 'Roberts Space Industries', 'StarCitizen'))
    installRoots.add(join(drive, 'Games', 'StarCitizen'))
  }

  return [...installRoots].flatMap((root) =>
    CHANNELS.map((channel) => join(root, channel, 'Data.p4k'))
  )
}

export async function resolveGameDataArchive(
  preferredPath: string | null,
  candidates: readonly string[] = getDefaultGameDataCandidates()
): Promise<GameDataArchive | null> {
  const paths = [
    ...new Set([preferredPath, ...candidates].filter((path): path is string => !!path))
  ]
  for (const path of paths) {
    try {
      return await validateGameDataArchive(path)
    } catch (error) {
      if (isMissingFileError(error)) continue
      if (error instanceof TypeError) continue
      if (path === preferredPath) throw error
    }
  }
  return null
}

export async function getGameArchiveFingerprint(archivePath: string): Promise<string> {
  const stats = await fs.stat(archivePath)
  return `${stats.size}:${Math.trunc(stats.mtimeMs)}`
}
