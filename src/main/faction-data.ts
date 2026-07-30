import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

import type {
  FactionAlignment,
  FactionCatalogResult,
  FactionReputation,
  FactionReputationScope,
  FactionReputationStanding
} from '../shared/contracts'
import { getGameArchiveFingerprint, type GameDataArchive } from './game-data'

const execFileAsync = promisify(execFile)
const EXTRACTOR_SCHEMA_VERSION = 1
const FACTION_CACHE_VERSION = 1
const MIN_FACTION_COUNT = 30
const MAX_FACTION_COUNT = 100
const MAX_SCOPE_COUNT = 20
const MAX_STANDING_COUNT = 100

interface FactionExtraction {
  gameVersion: string
  factions: FactionReputation[]
  warnings: string[]
}

export interface FactionDataResult extends FactionCatalogResult {
  warnings: string[]
}

interface FactionCache extends FactionExtraction {
  schemaVersion: number
  savedAt: string
  archiveFingerprint: string | null
  channel: string | null
}

export interface FactionDataOptions {
  cachePath: string
  extractorPath: string
  gameDataArchive: GameDataArchive | null
  forceRefresh?: boolean
  shouldWriteCache?: () => boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function readString(value: Record<string, unknown>, key: string, maxLength = 2_000): string | null {
  const candidate = value[key]
  return typeof candidate === 'string' && candidate.trim() && candidate.length <= maxLength
    ? candidate.trim()
    : null
}

function readNullableString(
  value: Record<string, unknown>,
  key: string,
  maxLength = 4_000
): string | null | undefined {
  const candidate = value[key]
  if (candidate === null) return null
  return typeof candidate === 'string' && candidate.trim() && candidate.length <= maxLength
    ? candidate.trim()
    : undefined
}

function readNumber(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function readCount(value: Record<string, unknown>, key: string): number | null {
  const candidate = readNumber(value, key)
  return candidate !== null && Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null
}

function parseStanding(value: unknown): FactionReputationStanding | null {
  if (!isRecord(value)) return null
  const id = readString(value, 'id', 100)
  const name = readString(value, 'name', 300)
  const minReputation = readNumber(value, 'minReputation')
  const driftReputation = readNumber(value, 'driftReputation')
  const driftTimeHours = readNumber(value, 'driftTimeHours')
  const perkDescription = readNullableString(value, 'perkDescription')
  if (
    !id ||
    !name ||
    minReputation === null ||
    driftReputation === null ||
    driftTimeHours === null ||
    driftTimeHours < 0 ||
    typeof value.gated !== 'boolean' ||
    perkDescription === undefined
  ) {
    return null
  }

  return {
    id,
    name,
    minReputation,
    driftReputation,
    driftTimeHours,
    gated: value.gated,
    perkDescription
  }
}

function parseScope(value: unknown): FactionReputationScope | null {
  if (!isRecord(value) || !Array.isArray(value.standings)) return null
  const id = readString(value, 'id', 100)
  const name = readString(value, 'name', 300)
  const description = readNullableString(value, 'description')
  const initialReputation = readNumber(value, 'initialReputation')
  const reputationCeiling = readNumber(value, 'reputationCeiling')
  if (
    !id ||
    !name ||
    description === undefined ||
    initialReputation === null ||
    reputationCeiling === null ||
    value.standings.length === 0 ||
    value.standings.length > MAX_STANDING_COUNT
  ) {
    return null
  }

  const standings = value.standings.map(parseStanding)
  if (
    standings.some((standing) => standing === null) ||
    new Set(standings.map((standing) => standing?.id)).size !== standings.length
  ) {
    return null
  }

  return {
    id,
    name,
    description,
    initialReputation,
    reputationCeiling,
    standings: standings as FactionReputationStanding[]
  }
}

export function parseGameFaction(value: unknown): FactionReputation | null {
  if (!isRecord(value) || !Array.isArray(value.scopes)) return null
  const id = readString(value, 'id', 100)
  const key = readString(value, 'key', 300)
  const name = readString(value, 'name', 300)
  const description = readNullableString(value, 'description')
  const headquarters = readNullableString(value, 'headquarters', 500)
  const focus = readNullableString(value, 'focus', 500)
  const scopeCount = readCount(value, 'scopeCount')
  const standingCount = readCount(value, 'standingCount')
  const alignment: FactionAlignment | null =
    value.alignment === 'lawful' || value.alignment === 'unlawful' || value.alignment === 'unknown'
      ? value.alignment
      : null
  if (
    !id ||
    !key ||
    !name ||
    description === undefined ||
    headquarters === undefined ||
    focus === undefined ||
    !alignment ||
    typeof value.isNpc !== 'boolean' ||
    typeof value.hidden !== 'boolean' ||
    scopeCount === null ||
    standingCount === null ||
    value.scopes.length > MAX_SCOPE_COUNT
  ) {
    return null
  }

  const scopes = value.scopes.map(parseScope)
  if (
    scopes.some((scope) => scope === null) ||
    scopes.length !== scopeCount ||
    scopes.reduce((total, scope) => total + (scope?.standings.length ?? 0), 0) !== standingCount ||
    new Set(scopes.map((scope) => scope?.id)).size !== scopes.length
  ) {
    return null
  }

  return {
    id,
    key,
    name,
    description,
    alignment,
    isNpc: value.isNpc,
    hidden: value.hidden,
    headquarters,
    focus,
    scopeCount,
    standingCount,
    scopes: scopes as FactionReputationScope[]
  }
}

export function parseGameFactionPayload(value: unknown): FactionExtraction {
  if (
    !isRecord(value) ||
    value.schemaVersion !== EXTRACTOR_SCHEMA_VERSION ||
    !Array.isArray(value.factions) ||
    value.factions.length < MIN_FACTION_COUNT ||
    value.factions.length > MAX_FACTION_COUNT ||
    !Array.isArray(value.warnings)
  ) {
    throw new TypeError('The game data extractor returned an unsupported faction response.')
  }

  const gameVersion = readString(value, 'gameVersion', 300)
  const factions = value.factions.map(parseGameFaction)
  if (!gameVersion || factions.some((faction) => faction === null)) {
    throw new TypeError('The game data extractor returned an invalid faction record.')
  }
  const typedFactions = factions as FactionReputation[]
  if (new Set(typedFactions.map((faction) => faction.id)).size !== typedFactions.length) {
    throw new Error('Installed game data produced duplicate faction identifiers.')
  }

  const warnings = value.warnings.map((warning) =>
    typeof warning === 'string' && warning.length <= 2_000 ? warning : null
  )
  if (warnings.some((warning) => warning === null)) {
    throw new TypeError('The game data extractor returned an invalid faction warning.')
  }

  return {
    gameVersion,
    factions: typedFactions,
    warnings: warnings as string[]
  }
}

async function extractGameFactions(
  extractorPath: string,
  archivePath: string
): Promise<FactionExtraction> {
  try {
    const { stdout } = await execFileAsync(extractorPath, [archivePath, 'factions'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 180_000,
      windowsHide: true
    })
    return parseGameFactionPayload(JSON.parse(stdout) as unknown)
  } catch (error) {
    const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : ''
    const message = stderr || (error instanceof Error ? error.message : String(error))
    throw new Error(`Installed game factions could not be extracted: ${message}`, {
      cause: error
    })
  }
}

function parseCache(value: unknown): FactionCache {
  if (
    !isRecord(value) ||
    value.schemaVersion !== FACTION_CACHE_VERSION ||
    typeof value.savedAt !== 'string' ||
    (value.archiveFingerprint !== null && typeof value.archiveFingerprint !== 'string') ||
    (value.channel !== null && typeof value.channel !== 'string')
  ) {
    throw new TypeError('The faction cache has an unexpected shape.')
  }

  const extraction = parseGameFactionPayload({
    schemaVersion: EXTRACTOR_SCHEMA_VERSION,
    gameVersion: value.gameVersion,
    factions: value.factions,
    warnings: value.warnings
  })
  return {
    ...extraction,
    schemaVersion: FACTION_CACHE_VERSION,
    savedAt: value.savedAt,
    archiveFingerprint: value.archiveFingerprint,
    channel: value.channel
  }
}

async function readCache(cachePath: string): Promise<FactionCache | null> {
  try {
    return parseCache(JSON.parse(await fs.readFile(cachePath, 'utf8')) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
}

async function writeCache(
  cachePath: string,
  extraction: FactionExtraction,
  archiveFingerprint: string,
  channel: string,
  shouldWrite: () => boolean
): Promise<string | null> {
  if (!shouldWrite()) return null
  const savedAt = new Date().toISOString()
  const cache: FactionCache = {
    ...extraction,
    schemaVersion: FACTION_CACHE_VERSION,
    savedAt,
    archiveFingerprint,
    channel
  }
  await fs.mkdir(dirname(cachePath), { recursive: true })
  const temporaryPath = `${cachePath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(cache)}\n`, 'utf8')
    if (!shouldWrite()) return null
    await fs.rename(temporaryPath, cachePath)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
  return savedAt
}

function toResult(
  extraction: FactionExtraction,
  state: FactionCatalogResult['state'],
  message: string,
  updatedAt: string
): FactionDataResult {
  return {
    factions: extraction.factions,
    gameVersion: extraction.gameVersion,
    state,
    message,
    updatedAt,
    warnings: [...extraction.warnings]
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function loadFactionData(
  options: FactionDataOptions,
  extract: (
    extractorPath: string,
    archivePath: string
  ) => Promise<FactionExtraction> = extractGameFactions
): Promise<FactionDataResult> {
  let cache: FactionCache | null = null
  let cacheError: string | null = null
  try {
    cache = await readCache(options.cachePath)
  } catch (error) {
    cacheError = errorMessage(error)
  }

  if (options.gameDataArchive) {
    let archiveFingerprint: string
    try {
      archiveFingerprint = await getGameArchiveFingerprint(options.gameDataArchive.path)
    } catch (error) {
      if (cache) {
        return toResult(
          cache,
          'cached',
          `Using cached installed-game factions. Game archive unavailable: ${errorMessage(error)}`,
          cache.savedAt
        )
      }
      throw new Error(
        `Installed game factions are unavailable and no local cache exists. ${errorMessage(error)}`,
        { cause: error }
      )
    }

    if (
      !options.forceRefresh &&
      cache?.archiveFingerprint === archiveFingerprint &&
      cache.channel === options.gameDataArchive.channel
    ) {
      return toResult(
        cache,
        'game',
        `Installed ${cache.channel} faction reputation - ${cache.gameVersion}`,
        cache.savedAt
      )
    }

    try {
      const extraction = await extract(options.extractorPath, options.gameDataArchive.path)
      let updatedAt = new Date().toISOString()
      let cacheWarning: string | null = null
      try {
        updatedAt =
          (await writeCache(
            options.cachePath,
            extraction,
            archiveFingerprint,
            options.gameDataArchive.channel,
            options.shouldWriteCache ?? (() => true)
          )) ?? updatedAt
      } catch (error) {
        cacheWarning = errorMessage(error)
      }

      const message = [
        `Installed ${options.gameDataArchive.channel} faction reputation - ${extraction.gameVersion}`,
        extraction.warnings.length > 0
          ? `${extraction.warnings.length} incomplete game records were skipped`
          : null,
        cacheWarning ? `Cache unavailable: ${cacheWarning}` : null
      ]
        .filter(Boolean)
        .join('. ')
      return toResult(extraction, 'game', message, updatedAt)
    } catch (error) {
      if (cache) {
        return toResult(
          cache,
          'cached',
          `Using cached installed-game factions. ${errorMessage(error)}`,
          cache.savedAt
        )
      }
      const cacheMessage = cacheError ? ` Cache error: ${cacheError}` : ''
      throw new Error(
        `Installed game factions are unavailable and no local cache exists. ${errorMessage(
          error
        )}${cacheMessage}`,
        { cause: error }
      )
    }
  }

  if (cache) {
    return toResult(
      cache,
      'cached',
      'Using cached installed-game factions. Choose Game files to refresh.',
      cache.savedAt
    )
  }
  if (cacheError) {
    throw new Error(`Choose Star Citizen Game files to load factions. Cache error: ${cacheError}`)
  }
  throw new Error('Choose Star Citizen Game files to load factions.')
}
