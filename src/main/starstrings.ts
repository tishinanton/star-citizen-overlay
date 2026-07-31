import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import extractZip from 'extract-zip'

import type { StarStringsInstallationSummary, StarStringsReleaseSummary } from '../shared/contracts'
import {
  getDefaultGameDataCandidates,
  validateGameDataArchive,
  type GameDataArchive
} from './game-data'

const RELEASE_API_URL = 'https://api.github.com/repos/MrKraken/StarStrings/releases/latest'
const RELEASE_DOWNLOAD_PREFIX = '/MrKraken/StarStrings/releases/download/'
const RELEASE_ASSET_NAME = 'StarStrings-LIVE.zip'
const INSTALL_RECORD_VERSION = 1
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
const MAX_LOCALIZATION_BYTES = 50 * 1024 * 1024
const GLOBAL_INI_RELATIVE_PATH = ['Data', 'Localization', 'english', 'global.ini'] as const

type Fetch = typeof fetch

export interface LatestStarStringsRelease extends StarStringsReleaseSummary {
  assetSize: number
  digest: string | null
  downloadUrl: string
}

export interface StarStringsInstallationInspection {
  installedRelease: StarStringsInstallationSummary | null
  localizationPresent: boolean
  warning: string | null
}

export interface StarStringsInstallProgress {
  stage: 'downloading' | 'installing'
  percentage: number | null
}

interface StarStringsInstallRecord extends StarStringsInstallationSummary {
  schemaVersion: number
  livePath: string
  globalIniSha256: string
}

interface Replacement {
  targetPath: string
  prepare: (stagedPath: string) => Promise<void>
}

interface PreparedReplacement extends Replacement {
  stagedPath: string
  backupPath: string
  hadOriginal: boolean
  installed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function isUnavailablePathError(error: unknown): boolean {
  if (!isRecord(error) || !('code' in error)) return false
  return ['EACCES', 'ENOENT', 'ENOTDIR', 'ENODEV', 'EPERM'].includes(
    String((error as { code?: unknown }).code)
  )
}

function requiredString(
  record: Record<string, unknown>,
  property: string,
  description: string
): string {
  const value = record[property]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`The StarStrings release ${description} is invalid.`)
  }
  return value.trim()
}

function requiredTimestamp(
  record: Record<string, unknown>,
  property: string,
  description: string
): string {
  const value = requiredString(record, property, description)
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`The StarStrings release ${description} is invalid.`)
  }
  return value
}

export function parseLatestStarStringsRelease(value: unknown): LatestStarStringsRelease {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || !Array.isArray(value.assets)) {
    throw new TypeError('GitHub returned an invalid StarStrings release.')
  }

  const asset = value.assets.find(
    (candidate) => isRecord(candidate) && candidate.name === RELEASE_ASSET_NAME
  )
  if (!isRecord(asset) || !Number.isSafeInteger(asset.id)) {
    throw new Error(`The latest StarStrings release does not include ${RELEASE_ASSET_NAME}.`)
  }

  const assetSize = asset.size
  if (
    typeof assetSize !== 'number' ||
    !Number.isSafeInteger(assetSize) ||
    assetSize <= 0 ||
    assetSize > MAX_ARCHIVE_BYTES
  ) {
    throw new RangeError('The StarStrings release archive has an unexpected size.')
  }

  const downloadUrl = requiredString(asset, 'browser_download_url', 'download URL')
  const parsedUrl = new URL(downloadUrl)
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.hostname !== 'github.com' ||
    !parsedUrl.pathname.startsWith(RELEASE_DOWNLOAD_PREFIX)
  ) {
    throw new TypeError('The StarStrings release download must come from its GitHub repository.')
  }

  const digestValue = asset.digest
  const digest =
    digestValue === null || digestValue === undefined
      ? null
      : typeof digestValue === 'string' && /^sha256:[a-f0-9]{64}$/i.test(digestValue)
        ? digestValue.toLowerCase()
        : null
  if (digestValue !== null && digestValue !== undefined && digest === null) {
    throw new TypeError('The StarStrings release checksum is invalid.')
  }

  return {
    version: `${value.id}:${asset.id}:${requiredTimestamp(asset, 'updated_at', 'asset timestamp')}`,
    name: requiredString(value, 'name', 'name'),
    publishedAt: requiredTimestamp(value, 'published_at', 'publication timestamp'),
    assetSize,
    digest,
    downloadUrl
  }
}

export async function fetchLatestStarStringsRelease(
  fetcher: Fetch = fetch
): Promise<LatestStarStringsRelease> {
  const response = await fetcher(RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Rockfall/StarStrings-sync',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status} while checking StarStrings.`)
  }
  return parseLatestStarStringsRelease(await response.json())
}

export async function resolveLiveGamePath(
  selectedArchive: GameDataArchive | null,
  defaultCandidates: readonly string[] = getDefaultGameDataCandidates()
): Promise<string | null> {
  const candidates: string[] = []
  if (selectedArchive) {
    const installRoot = dirname(dirname(selectedArchive.path))
    candidates.push(join(installRoot, 'LIVE', 'Data.p4k'))
    if (selectedArchive.channel.toUpperCase() === 'LIVE') {
      candidates.unshift(selectedArchive.path)
    }
  }
  candidates.push(
    ...defaultCandidates.filter(
      (candidate) => basename(dirname(candidate)).toUpperCase() === 'LIVE'
    )
  )

  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = resolve(candidate).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const archive = await validateGameDataArchive(candidate)
      if (archive.channel.toUpperCase() === 'LIVE') return dirname(archive.path)
    } catch (error) {
      if (isUnavailablePathError(error) || error instanceof TypeError) continue
      throw error
    }
  }
  return null
}

export function ensureEnglishLanguageConfig(contents: string): string {
  const directive = /^([ \t]*g_language[ \t]*=[ \t]*)([^\r\n]*)/im
  const match = directive.exec(contents)
  if (match) {
    if (match[2].trim().toLowerCase() === 'english') return contents
    return `${contents.slice(0, match.index)}${match[1]}english${contents.slice(
      match.index + match[0].length
    )}`
  }

  const lineEnding = contents.includes('\r\n') ? '\r\n' : '\n'
  const separator = contents.length > 0 && !contents.endsWith('\n') ? lineEnding : ''
  return `${contents}${separator}g_language = english${lineEnding}`
}

export async function inspectStarStringsInstallation(
  recordPath: string,
  livePath: string
): Promise<StarStringsInstallationInspection> {
  const globalIniPath = join(livePath, ...GLOBAL_INI_RELATIVE_PATH)
  const localizationPresent = await isFile(globalIniPath)
  if (!localizationPresent) {
    return { installedRelease: null, localizationPresent: false, warning: null }
  }

  try {
    const record = parseInstallRecord(JSON.parse(await fs.readFile(recordPath, 'utf8')))
    if (resolve(record.livePath).toLowerCase() !== resolve(livePath).toLowerCase()) {
      return { installedRelease: null, localizationPresent: true, warning: null }
    }
    if ((await sha256File(globalIniPath)) !== record.globalIniSha256) {
      return {
        installedRelease: null,
        localizationPresent: true,
        warning: 'The installed localization file changed after Rockfall last synced it.'
      }
    }
    return {
      installedRelease: {
        version: record.version,
        name: record.name,
        publishedAt: record.publishedAt,
        installedAt: record.installedAt
      },
      localizationPresent: true,
      warning: null
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { installedRelease: null, localizationPresent: true, warning: null }
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      installedRelease: null,
      localizationPresent: true,
      warning: `The StarStrings install record could not be read: ${message}`
    }
  }
}

function parseInstallRecord(value: unknown): StarStringsInstallRecord {
  if (!isRecord(value) || value.schemaVersion !== INSTALL_RECORD_VERSION) {
    throw new TypeError('The saved record version is unsupported.')
  }
  const globalIniSha256 = requiredString(value, 'globalIniSha256', 'saved checksum').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(globalIniSha256)) {
    throw new TypeError('The saved localization checksum is invalid.')
  }
  return {
    schemaVersion: INSTALL_RECORD_VERSION,
    livePath: requiredString(value, 'livePath', 'saved game path'),
    version: requiredString(value, 'version', 'saved version'),
    name: requiredString(value, 'name', 'saved name'),
    publishedAt: requiredTimestamp(value, 'publishedAt', 'saved publication timestamp'),
    installedAt: requiredTimestamp(value, 'installedAt', 'saved install timestamp'),
    globalIniSha256
  }
}

export async function installExtractedStarStrings(options: {
  extractedPath: string
  livePath: string
  recordPath: string
  release: StarStringsReleaseSummary
  installedAt?: string
}): Promise<StarStringsInstallationSummary> {
  const archive = await validateGameDataArchive(join(options.livePath, 'Data.p4k'))
  if (archive.channel.toUpperCase() !== 'LIVE') {
    throw new Error('StarStrings can only be installed into a Star Citizen LIVE folder.')
  }

  const sourceGlobalIni = join(options.extractedPath, ...GLOBAL_INI_RELATIVE_PATH)
  const sourceStats = await fs.stat(sourceGlobalIni)
  if (!sourceStats.isFile() || sourceStats.size <= 0 || sourceStats.size > MAX_LOCALIZATION_BYTES) {
    throw new Error('The StarStrings archive does not contain a valid English localization file.')
  }

  const globalIniSha256 = await sha256File(sourceGlobalIni)
  const installedAt = options.installedAt ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(installedAt))) {
    throw new TypeError('The StarStrings install timestamp is invalid.')
  }
  const installation: StarStringsInstallationSummary = {
    version: options.release.version,
    name: options.release.name,
    publishedAt: options.release.publishedAt,
    installedAt
  }
  const record: StarStringsInstallRecord = {
    schemaVersion: INSTALL_RECORD_VERSION,
    livePath: options.livePath,
    ...installation,
    globalIniSha256
  }

  const userCfgPath = await findUserConfigPath(options.livePath)
  const existingUserConfig = userCfgPath ? await fs.readFile(userCfgPath, 'utf8') : ''
  const targetUserConfig = userCfgPath ?? join(options.livePath, 'USER.cfg')
  const targetGlobalIni = join(options.livePath, ...GLOBAL_INI_RELATIVE_PATH)

  await replaceFiles([
    {
      targetPath: targetGlobalIni,
      prepare: (stagedPath) => fs.copyFile(sourceGlobalIni, stagedPath)
    },
    {
      targetPath: targetUserConfig,
      prepare: (stagedPath) =>
        fs.writeFile(stagedPath, ensureEnglishLanguageConfig(existingUserConfig), 'utf8')
    },
    {
      targetPath: options.recordPath,
      prepare: (stagedPath) =>
        fs.writeFile(stagedPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    }
  ])

  return installation
}

export async function downloadAndInstallStarStrings(options: {
  release: LatestStarStringsRelease
  livePath: string
  recordPath: string
  onProgress?: (progress: StarStringsInstallProgress) => void
  fetcher?: Fetch
}): Promise<StarStringsInstallationSummary> {
  const temporaryPath = await fs.mkdtemp(join(tmpdir(), 'rockfall-starstrings-'))
  const archivePath = join(temporaryPath, RELEASE_ASSET_NAME)
  const extractedPath = join(temporaryPath, 'extracted')
  try {
    await downloadRelease(options.release, archivePath, options.fetcher ?? fetch, (percentage) =>
      options.onProgress?.({ stage: 'downloading', percentage })
    )
    options.onProgress?.({ stage: 'installing', percentage: null })
    await fs.mkdir(extractedPath)
    await extractZip(archivePath, { dir: extractedPath })
    return await installExtractedStarStrings({
      extractedPath,
      livePath: options.livePath,
      recordPath: options.recordPath,
      release: options.release
    })
  } finally {
    await fs.rm(temporaryPath, { recursive: true, force: true })
  }
}

async function downloadRelease(
  release: LatestStarStringsRelease,
  destinationPath: string,
  fetcher: Fetch,
  onProgress: (percentage: number) => void
): Promise<void> {
  const response = await fetcher(release.downloadUrl, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'Rockfall/StarStrings-sync'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000)
  })
  if (!response.ok || !response.body) {
    throw new Error(`GitHub returned HTTP ${response.status} while downloading StarStrings.`)
  }

  const chunks: Buffer[] = []
  const reader = response.body.getReader()
  let received = 0
  let lastPercentage = -1
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > release.assetSize || received > MAX_ARCHIVE_BYTES) {
      await reader.cancel()
      throw new Error('The StarStrings download exceeded its expected size.')
    }
    chunks.push(Buffer.from(value))
    const percentage = Math.min(100, Math.floor((received / release.assetSize) * 100))
    if (percentage !== lastPercentage) {
      lastPercentage = percentage
      onProgress(percentage)
    }
  }
  if (received !== release.assetSize) {
    throw new Error('The StarStrings download size did not match the GitHub release.')
  }

  const archive = Buffer.concat(chunks)
  if (release.digest) {
    const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`
    if (digest !== release.digest) {
      throw new Error('The StarStrings download did not match its GitHub checksum.')
    }
  }
  await fs.writeFile(destinationPath, archive)
  if (lastPercentage !== 100) onProgress(100)
}

async function findUserConfigPath(livePath: string): Promise<string | null> {
  const entries = await fs.readdir(livePath, { withFileTypes: true })
  const match = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === 'user.cfg')
  return match ? join(livePath, match.name) : null
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await fs.readFile(path))
    .digest('hex')
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile()
  } catch (error) {
    if (isMissingFileError(error)) return false
    throw error
  }
}

async function replaceFiles(replacements: Replacement[]): Promise<void> {
  const prepared: PreparedReplacement[] = replacements.map((replacement) => {
    const token = randomUUID()
    const directory = dirname(replacement.targetPath)
    const name = basename(replacement.targetPath)
    return {
      ...replacement,
      stagedPath: join(directory, `.${name}.${token}.new`),
      backupPath: join(directory, `.${name}.${token}.backup`),
      hadOriginal: false,
      installed: false
    }
  })

  try {
    for (const replacement of prepared) {
      await fs.mkdir(dirname(replacement.targetPath), { recursive: true })
      await replacement.prepare(replacement.stagedPath)
    }
    for (const replacement of prepared) {
      if (await isFile(replacement.targetPath)) {
        await fs.rename(replacement.targetPath, replacement.backupPath)
        replacement.hadOriginal = true
      }
      await fs.rename(replacement.stagedPath, replacement.targetPath)
      replacement.installed = true
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const replacement of [...prepared].reverse()) {
      try {
        if (replacement.installed) {
          await fs.rm(replacement.targetPath, { force: true })
        }
        if (replacement.hadOriginal) {
          await fs.rename(replacement.backupPath, replacement.targetPath)
        }
        await fs.rm(replacement.stagedPath, { force: true })
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'StarStrings installation failed and could not be fully rolled back.'
      )
    }
    throw error
  }

  for (const replacement of prepared) {
    if (replacement.hadOriginal) {
      await fs.rm(replacement.backupPath, { force: true })
    }
  }
}
