import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

import type {
  BlueprintCatalogResult,
  BlueprintDetail,
  BlueprintIngredient,
  BlueprintIngredientKind,
  BlueprintOutputStat,
  BlueprintRequirementGroup,
  BlueprintRequirementIngredient,
  BlueprintRenderAsset,
  BlueprintSummary,
  BlueprintUnlockMission,
  LocalizationSource
} from '../shared/contracts'
import { getLocalizedGameArchiveFingerprint, type GameDataArchive } from './game-data'

const execFileAsync = promisify(execFile)
const EXTRACTOR_SCHEMA_VERSION = 10
const BLUEPRINT_CACHE_VERSION = 11
const MIN_SUPPORTED_BLUEPRINT_CACHE_VERSION = 4
const MIN_BLUEPRINT_COUNT = 1_500
const MAX_BLUEPRINT_COUNT = 2_500
const MAX_ICON_COUNT = 200
const MAX_ICON_DATA_LENGTH = 128_000

interface BlueprintExtraction {
  gameVersion: string
  details: BlueprintDetail[]
  icons: Record<string, string>
  warnings: string[]
}

interface BlueprintCache extends BlueprintExtraction {
  schemaVersion: number
  savedAt: string
  archiveFingerprint: string | null
  channel: string | null
  localizationSource: LocalizationSource
}

export interface BlueprintDataOptions {
  cachePath: string
  extractorPath: string
  gameDataArchive: GameDataArchive | null
  localizationSource?: LocalizationSource
  forceRefresh?: boolean
  shouldWriteCache?: () => boolean
}

export interface BlueprintDataResult {
  catalog: BlueprintCatalogResult
  details: Record<string, BlueprintDetail>
  gameVersion: string
  warnings: string[]
}

export interface BlueprintDataLoad {
  cached: BlueprintDataResult | null
  refreshed: Promise<BlueprintDataResult>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

function readNumber(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function readNonNegativeInteger(value: Record<string, unknown>, key: string): number | null {
  const candidate = readNumber(value, key)
  return candidate !== null && Number.isInteger(candidate) && candidate >= 0 ? candidate : null
}

function readStringArray(
  value: Record<string, unknown>,
  key: string,
  maxItems: number
): string[] | null {
  const candidate = value[key]
  if (!Array.isArray(candidate) || candidate.length > maxItems) return null
  const strings: string[] = []
  for (const entry of candidate) {
    if (typeof entry !== 'string' || entry.length > 100) return null
    const normalized = entry.trim()
    if (!normalized) return null
    strings.push(normalized)
  }
  const unique = new Set(strings)
  return unique.size === strings.length ? [...unique] : null
}

function parseHttpsUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > 2_000) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function parseRenderAsset(value: unknown): BlueprintRenderAsset | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new TypeError('The blueprint render asset is invalid.')
  const path = readString(value, 'path')
  const format = readString(value, 'format')
  if (
    !path ||
    path.length > 500 ||
    !/^Objects\/(?!.*(?:^|\/)\.\.(?:\/|$))[^<>:"|?*]+\.(?:cgf|cga|skin|chr)$/i.test(path) ||
    (format !== 'cgf' && format !== 'cga' && format !== 'skin' && format !== 'chr')
  ) {
    throw new TypeError('The blueprint render asset is invalid.')
  }
  return { path, format }
}

function parseIngredient(value: unknown): BlueprintIngredient | null {
  if (!isRecord(value)) return null
  const name = readString(value, 'name')
  if (!name) return null

  const rawKind = readString(value, 'kind')
  const kind: BlueprintIngredientKind =
    rawKind === 'resource' || rawKind === 'item' ? rawKind : 'unknown'
  const quantity = readNumber(value, 'quantity')
  const quantityScu = readNumber(value, 'quantityScu')
  return {
    name,
    kind,
    quantity: quantity !== null && quantity >= 0 ? quantity : null,
    quantityScu: quantityScu !== null && quantityScu >= 0 ? quantityScu : null,
    webUrl: parseHttpsUrl(value.webUrl)
  }
}

function parseRequirementIngredient(value: unknown): BlueprintRequirementIngredient | null {
  if (!isRecord(value)) return null
  const ingredient = parseIngredient(value)
  if (!ingredient) return null
  const minQuality = readNumber(value, 'minQuality')
  return {
    ...ingredient,
    minQuality: minQuality !== null && minQuality >= 0 ? minQuality : null
  }
}

function parseRequirementGroup(value: unknown, index: number): BlueprintRequirementGroup | null {
  if (!isRecord(value) || !Array.isArray(value.ingredients)) return null
  const key = readString(value, 'key') ?? `requirement-${index + 1}`
  const name = readString(value, 'name') ?? key
  const requiredCount = readNonNegativeInteger(value, 'requiredCount')
  const ingredients = value.ingredients.map(parseRequirementIngredient)
  if (
    requiredCount === null ||
    requiredCount < 1 ||
    ingredients.length === 0 ||
    ingredients.some((ingredient) => ingredient === null)
  ) {
    return null
  }
  return {
    key,
    name,
    requiredCount,
    ingredients: ingredients as BlueprintRequirementIngredient[]
  }
}

function parseOutputStat(value: unknown): BlueprintOutputStat | null {
  if (!isRecord(value)) return null
  const key = readString(value, 'key')
  const label = readString(value, 'label')
  const statValue = readString(value, 'value')
  if (
    !key ||
    key.length > 80 ||
    !label ||
    label.length > 80 ||
    !statValue ||
    statValue.length > 100
  ) {
    return null
  }
  return { key, label, value: statValue }
}

function parseMission(value: unknown): BlueprintUnlockMission | null {
  if (!isRecord(value)) return null
  const id = readString(value, 'id')
  const title = readString(value, 'title')
  if (!id || !title) return null
  const chance = readNumber(value, 'chance')
  const starSystems = readStringArray(value, 'starSystems', 10)
  if (!starSystems || typeof value.reputationVaries !== 'boolean') return null
  return {
    id,
    title,
    missionType: readString(value, 'missionType'),
    contractType: readString(value, 'contractType'),
    provider: readString(value, 'provider'),
    minimumReputation: readString(value, 'minimumReputation'),
    reputationVaries: value.reputationVaries,
    starSystems,
    chance: chance !== null && chance >= 0 && chance <= 1 ? chance : null,
    webUrl: parseHttpsUrl(value.webUrl)
  }
}

export function parseGameBlueprint(value: unknown): BlueprintDetail | null {
  if (!isRecord(value)) return null
  const id = readString(value, 'id')
  const key = readString(value, 'key')
  const outputName = readString(value, 'outputName')
  const outputClass = readString(value, 'outputClass')
  const outputType = readString(value, 'outputType')
  const outputTypeLabel = readString(value, 'outputTypeLabel')
  const craftTimeSeconds = readNonNegativeInteger(value, 'craftTimeSeconds')
  const craftTimeLabel = readString(value, 'craftTimeLabel')
  const ingredientCount = readNonNegativeInteger(value, 'ingredientCount')
  const unlockingMissionCount = readNonNegativeInteger(value, 'unlockingMissionCount')
  const gameVersion = readString(value, 'gameVersion')
  if (
    !id ||
    id.length > 200 ||
    !key ||
    !outputName ||
    !outputClass ||
    !outputType ||
    !outputTypeLabel ||
    craftTimeSeconds === null ||
    !craftTimeLabel ||
    ingredientCount === null ||
    unlockingMissionCount === null ||
    !gameVersion ||
    !Array.isArray(value.ingredients) ||
    !Array.isArray(value.outputStats) ||
    value.outputStats.length > 16 ||
    !Array.isArray(value.requirementGroups) ||
    !Array.isArray(value.unlockingMissions)
  ) {
    return null
  }

  const ingredients = value.ingredients.map(parseIngredient)
  const outputStats = value.outputStats.map(parseOutputStat)
  const requirementGroups = value.requirementGroups.map(parseRequirementGroup)
  const unlockingMissions = value.unlockingMissions.map(parseMission)
  if (
    ingredients.some((ingredient) => ingredient === null) ||
    outputStats.some((stat) => stat === null) ||
    new Set(outputStats.map((stat) => stat?.key)).size !== outputStats.length ||
    requirementGroups.some((group) => group === null) ||
    unlockingMissions.some((mission) => mission === null) ||
    unlockingMissions.length !== unlockingMissionCount
  ) {
    return null
  }

  const imageKey = readString(value, 'imageKey')
  return {
    id,
    key,
    isNew: value.isNew === true,
    outputName,
    outputClass,
    outputType,
    outputTypeLabel,
    outputGrade: readString(value, 'outputGrade'),
    craftTimeSeconds,
    craftTimeLabel,
    availableByDefault: value.availableByDefault === true,
    ingredientCount,
    unlockingMissionCount,
    ingredients: ingredients as BlueprintIngredient[],
    outputDescription: readString(value, 'outputDescription'),
    outputManufacturer: readString(value, 'outputManufacturer'),
    outputStats: outputStats as BlueprintOutputStat[],
    requirementGroups: requirementGroups as BlueprintRequirementGroup[],
    unlockingMissions: unlockingMissions as BlueprintUnlockMission[],
    gameVersion,
    imageKey: imageKey && imageKey.length <= 500 ? imageKey : null,
    renderAsset: parseRenderAsset(value.renderAsset),
    webUrl: parseHttpsUrl(value.webUrl)
  }
}

function parseIcons(value: unknown): Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length > MAX_ICON_COUNT) {
    throw new TypeError('The game data extractor returned invalid blueprint icons.')
  }

  const icons: Record<string, string> = {}
  for (const [key, dataUrl] of Object.entries(value)) {
    if (
      !key ||
      key.length > 500 ||
      typeof dataUrl !== 'string' ||
      !dataUrl.startsWith('data:image/png;base64,') ||
      dataUrl.length > MAX_ICON_DATA_LENGTH
    ) {
      throw new TypeError('The game data extractor returned an invalid blueprint icon.')
    }
    const image = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
    if (
      image.length < 20 ||
      image.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0 ||
      image.indexOf(Buffer.from('IEND', 'ascii')) < 0
    ) {
      throw new TypeError('The game data extractor returned invalid blueprint PNG data.')
    }
    icons[key] = dataUrl
  }
  return icons
}

export function parseGameBlueprintPayload(value: unknown): BlueprintExtraction {
  if (
    !isRecord(value) ||
    value.schemaVersion !== EXTRACTOR_SCHEMA_VERSION ||
    !Array.isArray(value.blueprints) ||
    value.blueprints.length < MIN_BLUEPRINT_COUNT ||
    value.blueprints.length > MAX_BLUEPRINT_COUNT ||
    !Array.isArray(value.warnings)
  ) {
    throw new TypeError('The game data extractor returned an unsupported blueprint response.')
  }

  const gameVersion = readString(value, 'gameVersion')
  if (!gameVersion) {
    throw new TypeError('The game data extractor did not report a game version.')
  }
  const details = value.blueprints.map(parseGameBlueprint)
  if (details.some((blueprint) => blueprint === null)) {
    throw new TypeError('The game data extractor returned an invalid blueprint record.')
  }
  const typedDetails = details as BlueprintDetail[]
  if (new Set(typedDetails.map((blueprint) => blueprint.id)).size !== typedDetails.length) {
    throw new Error('Installed game data produced duplicate blueprint identifiers.')
  }

  const warnings = value.warnings.map((warning) =>
    typeof warning === 'string' && warning.length <= 2_000 ? warning : null
  )
  if (warnings.some((warning) => warning === null)) {
    throw new TypeError('The game data extractor returned an invalid blueprint warning.')
  }
  return {
    gameVersion,
    details: typedDetails,
    icons: parseIcons(value.icons),
    warnings: warnings as string[]
  }
}

async function extractGameBlueprints(
  extractorPath: string,
  archivePath: string,
  localizationSource: LocalizationSource = 'game'
): Promise<BlueprintExtraction> {
  try {
    const { stdout } = await execFileAsync(
      extractorPath,
      [archivePath, 'blueprints', localizationSource],
      {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 300_000,
        windowsHide: true
      }
    )
    return parseGameBlueprintPayload(JSON.parse(stdout) as unknown)
  } catch (error) {
    const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : ''
    const message = stderr || (error instanceof Error ? error.message : String(error))
    throw new Error(`Installed game blueprints could not be extracted: ${message}`, {
      cause: error
    })
  }
}

function parseCache(value: unknown): BlueprintCache {
  const schemaVersion = isRecord(value) ? readNonNegativeInteger(value, 'schemaVersion') : null
  if (
    !isRecord(value) ||
    schemaVersion === null ||
    schemaVersion < MIN_SUPPORTED_BLUEPRINT_CACHE_VERSION ||
    schemaVersion > BLUEPRINT_CACHE_VERSION ||
    typeof value.savedAt !== 'string' ||
    (value.archiveFingerprint !== null && typeof value.archiveFingerprint !== 'string') ||
    (value.channel !== null && typeof value.channel !== 'string')
  ) {
    throw new TypeError('The blueprint cache has an unexpected shape.')
  }

  const extraction = parseGameBlueprintPayload({
    schemaVersion: EXTRACTOR_SCHEMA_VERSION,
    gameVersion: value.gameVersion,
    blueprints: Array.isArray(value.details)
      ? value.details.map(normalizeCachedBlueprint)
      : value.details,
    icons: value.icons,
    warnings: value.warnings
  })
  return {
    ...extraction,
    schemaVersion,
    savedAt: value.savedAt,
    archiveFingerprint: value.archiveFingerprint,
    channel: value.channel,
    localizationSource: value.localizationSource === 'global-ini' ? 'global-ini' : 'game'
  }

  function normalizeCachedBlueprint(value: unknown): unknown {
    if (!isRecord(value)) return value
    return {
      ...value,
      outputDescription:
        typeof value.outputDescription === 'string' ? value.outputDescription : null,
      outputManufacturer:
        typeof value.outputManufacturer === 'string' ? value.outputManufacturer : null,
      outputStats: Array.isArray(value.outputStats) ? value.outputStats : []
    }
  }
}

async function readCache(cachePath: string): Promise<BlueprintCache | null> {
  try {
    return parseCache(JSON.parse(await fs.readFile(cachePath, 'utf8')) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
}

async function writeCache(
  cachePath: string,
  extraction: BlueprintExtraction,
  archiveFingerprint: string,
  channel: string,
  localizationSource: LocalizationSource,
  shouldWrite: () => boolean
): Promise<string | null> {
  if (!shouldWrite()) return null
  const savedAt = new Date().toISOString()
  const cache: BlueprintCache = {
    ...extraction,
    schemaVersion: BLUEPRINT_CACHE_VERSION,
    savedAt,
    archiveFingerprint,
    channel,
    localizationSource
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

function toSummary(detail: BlueprintDetail): BlueprintSummary {
  const {
    outputDescription,
    outputManufacturer,
    outputStats,
    requirementGroups,
    unlockingMissions,
    ...summary
  } = detail
  void outputDescription
  void outputManufacturer
  void outputStats
  void requirementGroups
  void unlockingMissions
  return summary
}

function toResult(
  extraction: BlueprintExtraction,
  state: BlueprintCatalogResult['state'],
  message: string,
  updatedAt: string
): BlueprintDataResult {
  return {
    catalog: {
      blueprints: extraction.details.map(toSummary),
      icons: extraction.icons,
      state,
      message,
      updatedAt
    },
    details: Object.fromEntries(extraction.details.map((blueprint) => [blueprint.id, blueprint])),
    gameVersion: extraction.gameVersion,
    warnings: [...extraction.warnings]
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function resolveBlueprintData(
  options: BlueprintDataOptions,
  cache: BlueprintCache | null,
  cacheError: string | null,
  extract: (
    extractorPath: string,
    archivePath: string,
    localizationSource?: LocalizationSource
  ) => Promise<BlueprintExtraction> = extractGameBlueprints
): Promise<BlueprintDataResult> {
  const selectedLocalizationSource = options.localizationSource ?? 'game'

  if (cache?.localizationSource !== selectedLocalizationSource) {
    cache = null
  }

  if (options.gameDataArchive) {
    let archiveFingerprint: string
    try {
      archiveFingerprint = await getLocalizedGameArchiveFingerprint(
        options.gameDataArchive.path,
        selectedLocalizationSource
      )
    } catch (error) {
      if (cache) {
        return toResult(
          cache,
          'cached',
          `Using cached installed-game blueprints. Game archive unavailable: ${errorMessage(
            error
          )}`,
          cache.savedAt
        )
      }
      throw new Error(
        `Installed game blueprints are unavailable and no local cache exists. ${errorMessage(
          error
        )}`,
        { cause: error }
      )
    }
    if (
      !options.forceRefresh &&
      cache?.schemaVersion === BLUEPRINT_CACHE_VERSION &&
      cache?.archiveFingerprint === archiveFingerprint &&
      cache.channel === options.gameDataArchive.channel
    ) {
      return toResult(
        cache,
        'game',
        `Installed ${cache.channel} blueprints · ${cache.gameVersion}`,
        cache.savedAt
      )
    }

    try {
      const extraction = await extract(
        options.extractorPath,
        options.gameDataArchive.path,
        selectedLocalizationSource
      )
      let updatedAt = new Date().toISOString()
      let cacheWarning: string | null = null
      try {
        updatedAt =
          (await writeCache(
            options.cachePath,
            extraction,
            archiveFingerprint,
            options.gameDataArchive.channel,
            selectedLocalizationSource,
            options.shouldWriteCache ?? (() => true)
          )) ?? updatedAt
      } catch (error) {
        cacheWarning = errorMessage(error)
      }

      const warningCount = extraction.warnings.length
      const message = [
        `Installed ${options.gameDataArchive.channel} blueprints · ${extraction.gameVersion}`,
        warningCount > 0 ? `${warningCount} incomplete game records were skipped` : null,
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
          `Using cached installed-game blueprints. ${errorMessage(error)}`,
          cache.savedAt
        )
      }
      const cacheMessage = cacheError ? ` Cache error: ${cacheError}` : ''
      throw new Error(
        `Installed game blueprints are unavailable and no local cache exists. ${errorMessage(
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
      'Using cached installed-game blueprints. Choose Game files to refresh.',
      cache.savedAt
    )
  }
  if (cacheError) {
    throw new Error(`Choose Star Citizen Game files to load blueprints. Cache error: ${cacheError}`)
  }
  throw new Error('Choose Star Citizen Game files to load blueprints.')
}

export async function prepareBlueprintDataLoad(
  options: BlueprintDataOptions,
  extract: (
    extractorPath: string,
    archivePath: string,
    localizationSource?: LocalizationSource
  ) => Promise<BlueprintExtraction> = extractGameBlueprints
): Promise<BlueprintDataLoad> {
  let cache: BlueprintCache | null = null
  let cacheError: string | null = null
  try {
    cache = await readCache(options.cachePath)
  } catch (error) {
    cacheError = errorMessage(error)
  }

  const selectedCache =
    cache?.localizationSource === (options.localizationSource ?? 'game') ? cache : null
  return {
    cached:
      selectedCache && !options.forceRefresh
        ? toResult(
            selectedCache,
            'cached',
            'Using cached installed-game blueprints while checking for updates.',
            selectedCache.savedAt
          )
        : null,
    refreshed: resolveBlueprintData(options, cache, cacheError, extract)
  }
}

export async function loadBlueprintData(
  options: BlueprintDataOptions,
  extract: (
    extractorPath: string,
    archivePath: string,
    localizationSource?: LocalizationSource
  ) => Promise<BlueprintExtraction> = extractGameBlueprints
): Promise<BlueprintDataResult> {
  return (await prepareBlueprintDataLoad(options, extract)).refreshed
}
