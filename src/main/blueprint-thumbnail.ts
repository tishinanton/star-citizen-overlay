import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import type {
  BlueprintDetail,
  BlueprintThumbnailResult,
  BlueprintRenderAsset
} from '../shared/contracts'
import { getGameArchiveFingerprint, type GameDataArchive } from './game-data'
import { renderGlbThumbnail } from './glb-thumbnail-renderer'

const execFileAsync = promisify(execFile)
const THUMBNAIL_SCHEMA_VERSION = 1
const MAX_PNG_BYTES = 1024 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

interface ThumbnailGenerationContext {
  blueprint: BlueprintDetail
  archive: GameDataArchive
  temporaryDirectory: string
}

export interface BlueprintThumbnailServiceOptions {
  cacheDirectory: string
  temporaryDirectory: string
  extractorPath: string
  converterPath: string
  getGameDataArchive: () => GameDataArchive | null
  generate?: (context: ThumbnailGenerationContext) => Promise<Buffer>
  fingerprint?: (archivePath: string) => Promise<string>
  logError?: (message: string, error?: unknown) => void
}

export class BlueprintThumbnailService {
  readonly #pending = new Map<
    string,
    { sequence: number; request: Promise<BlueprintThumbnailResult> }
  >()
  readonly #options: BlueprintThumbnailServiceOptions
  #converterAvailability: Promise<void> | null = null
  #generationActive = false
  #nextGeneration: {
    getSequence: () => number
    operation: () => Promise<BlueprintThumbnailResult>
    resolve: (value: BlueprintThumbnailResult) => void
  } | null = null
  readonly #temporarySweep: Promise<void>
  #latestRequestSequence = 0

  constructor(options: BlueprintThumbnailServiceOptions) {
    this.#options = options
    this.#temporarySweep = sweepTemporaryDirectories(options.temporaryDirectory).catch((error) => {
      ;(options.logError ?? console.error)(
        '[blueprint-thumbnail] Stale temporary assets could not be fully removed.',
        error
      )
    })
  }

  async get(blueprint: BlueprintDetail): Promise<BlueprintThumbnailResult> {
    const sequence = ++this.#latestRequestSequence
    const asset = blueprint.renderAsset
    if (!asset) {
      return result('unsupported', 'This output does not reference a renderable game asset.')
    }
    if (asset.format === 'skin' || asset.format === 'chr') {
      return result(
        'unsupported',
        `Skinned ${asset.format.toUpperCase()} assets are not supported by the local thumbnail renderer.`
      )
    }
    if (asset.format !== 'cgf' && asset.format !== 'cga') {
      return result('unsupported', `Geometry format ${asset.format} is not supported.`)
    }

    const archive = this.#options.getGameDataArchive()
    if (!archive) {
      return result('unavailable', 'Select installed Star Citizen game data to generate this thumbnail.')
    }

    let fingerprint: string
    try {
      fingerprint = await (this.#options.fingerprint ?? getGameArchiveFingerprint)(archive.path)
    } catch (error) {
      this.#log(blueprint, 'Archive fingerprint could not be read.', error)
      return result('unavailable', 'The selected Star Citizen archive is unavailable.')
    }

    const cachePath = thumbnailCachePath(
      this.#options.cacheDirectory,
      fingerprint,
      blueprint.outputClass,
      asset
    )
    const existing = this.#pending.get(cachePath)
    if (existing) {
      existing.sequence = sequence
      return existing.request
    }

    let pending!: { sequence: number; request: Promise<BlueprintThumbnailResult> }
    const request = this.#loadOrGenerate(blueprint, archive, cachePath, () => pending.sequence).finally(() => {
      if (this.#pending.get(cachePath) === pending) this.#pending.delete(cachePath)
    })
    pending = { sequence, request }
    this.#pending.set(cachePath, pending)
    return request
  }

  async #loadOrGenerate(
    blueprint: BlueprintDetail,
    archive: GameDataArchive,
    cachePath: string,
    getSequence: () => number
  ): Promise<BlueprintThumbnailResult> {
    try {
      const cached = await fs.readFile(cachePath)
      validatePng(cached)
      return readyResult(cached, 'Generated locally from cached installed-game geometry.')
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.#log(blueprint, 'Cached thumbnail could not be read; regenerating it.', error)
      }
    }

    return this.#enqueueGeneration(getSequence, async () => {
      await this.#temporarySweep
      await fs.mkdir(this.#options.temporaryDirectory, { recursive: true })
      const temporaryDirectory = await fs.mkdtemp(
        join(this.#options.temporaryDirectory, 'blueprint-thumbnail-')
      )
      try {
        const png = await (this.#options.generate ?? ((context) => this.#generate(context)))({
          blueprint,
          archive,
          temporaryDirectory
        })
      validatePng(png)
      let cacheWarning: string | null = null
      try {
        await writeAtomically(cachePath, png)
      } catch (error) {
        cacheWarning = ' The local thumbnail cache could not be updated.'
        this.#log(blueprint, 'Generated thumbnail could not be cached.', error)
      }
        return readyResult(png, `Generated locally from installed-game geometry.${cacheWarning ?? ''}`)
      } catch (error) {
        if (error instanceof ThumbnailUnavailableError) {
          this.#log(blueprint, error.message)
          return result('unavailable', error.message)
        }
        this.#log(blueprint, 'Thumbnail generation failed.', error)
        return result(
          'error',
          `Local thumbnail generation failed: ${error instanceof Error ? error.message : String(error)}`
        )
      } finally {
        try {
          await removeDirectoryWithRetry(temporaryDirectory)
        } catch (error) {
          this.#log(blueprint, 'Temporary thumbnail assets could not be removed.', error)
        }
      }
    })
  }

  async #generate(context: ThumbnailGenerationContext): Promise<Buffer> {
    const asset = context.blueprint.renderAsset
    if (!asset) throw new Error('Blueprint render asset is missing.')
    await this.#ensureConverterAvailable()
    const extractionDirectory = join(context.temporaryDirectory, 'source')
    const conversionDirectory = join(context.temporaryDirectory, 'converted')
    await fs.mkdir(extractionDirectory)
    await fs.mkdir(conversionDirectory)

    let extractionOutput: string
    try {
      const { stdout } = await execFileAsync(
        this.#options.extractorPath,
        [
          context.archive.path,
          'thumbnail-asset',
          asset.path,
          extractionDirectory
        ],
        {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          timeout: 120_000,
          windowsHide: true
        }
      )
      extractionOutput = stdout
    } catch (error) {
      throw new Error(`Game geometry could not be extracted: ${processErrorMessage(error)}`, {
        cause: error
      })
    }

    const assetFileName = parseAssetExtraction(extractionOutput)
    const sourcePath = resolve(extractionDirectory, assetFileName)
    assertDirectChild(sourcePath, extractionDirectory)
    try {
      await execFileAsync(
        this.#options.converterPath,
        [
          sourcePath,
          '-glb',
          '-notex',
          '-out',
          conversionDirectory,
          '-loglevel',
          'error'
        ],
        {
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          timeout: 180_000,
          windowsHide: true
        }
      )
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new ThumbnailUnavailableError(
          'Install Cryengine Converter 2.0 or configure ROCKFALL_CGF_CONVERTER to enable local 3D thumbnails.'
        )
      }
      throw new Error(`Game geometry conversion failed: ${processErrorMessage(error)}`, {
        cause: error
      })
    }

    const glbPath = join(conversionDirectory, `${basename(assetFileName, extname(assetFileName))}.glb`)
    return renderGlbThumbnail(await fs.readFile(glbPath), 256)
  }

  #ensureConverterAvailable(): Promise<void> {
    this.#converterAvailability ??= execFileAsync(this.#options.converterPath, ['-usage'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
      windowsHide: true
    })
      .then(() => undefined)
      .catch((error) => {
        if (isMissingFileError(error)) {
          throw new ThumbnailUnavailableError(
            'Install Cryengine Converter 2.0 or configure ROCKFALL_CGF_CONVERTER to enable local 3D thumbnails.'
          )
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'stdout' in error &&
          typeof (error as { stdout?: unknown }).stdout === 'string' &&
          (error as { stdout: string }).stdout.includes('CryEngine Converter v2.')
        ) {
          return
        }
        throw new Error(`Cryengine Converter could not be started: ${processErrorMessage(error)}`, {
          cause: error
        })
      })
    return this.#converterAvailability
  }

  #enqueueGeneration(
    getSequence: () => number,
    operation: () => Promise<BlueprintThumbnailResult>
  ): Promise<BlueprintThumbnailResult> {
    return new Promise((resolve) => {
      const job = { getSequence, operation, resolve }
      if (getSequence() < this.#latestRequestSequence) {
        resolve(result('unavailable', 'Thumbnail generation was superseded by a newer selection.'))
        return
      }
      if (!this.#generationActive) {
        this.#generationActive = true
        void this.#runGeneration(job)
        return
      }
      if (this.#nextGeneration && this.#nextGeneration.getSequence() > getSequence()) {
        resolve(result('unavailable', 'Thumbnail generation was superseded by a newer selection.'))
        return
      }
      this.#nextGeneration?.resolve(result('unavailable', 'Thumbnail generation was superseded by a newer selection.'))
      this.#nextGeneration = job
    })
  }

  async #runGeneration(job: {
    getSequence: () => number
    operation: () => Promise<BlueprintThumbnailResult>
    resolve: (value: BlueprintThumbnailResult) => void
  }): Promise<void> {
    try {
      job.resolve(await job.operation())
    } catch (error) {
      job.resolve(
        result(
          'error',
          `Local thumbnail generation failed: ${error instanceof Error ? error.message : String(error)}`
        )
      )
    } finally {
      const next = this.#nextGeneration
      this.#nextGeneration = null
      if (next) {
        if (next.getSequence() < this.#latestRequestSequence) {
          next.resolve(result('unavailable', 'Thumbnail generation was superseded by a newer selection.'))
          this.#generationActive = false
        } else {
          void this.#runGeneration(next)
        }
      } else {
        this.#generationActive = false
      }
    }
  }

  #log(blueprint: BlueprintDetail, message: string, error?: unknown): void {
    ;(this.#options.logError ?? console.error)(
      `[blueprint-thumbnail:${blueprint.outputClass}] ${message}`,
      error
    )
  }
}

function parseAssetExtraction(stdout: string): string {
  const value = JSON.parse(stdout) as unknown
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('assetFileName' in value) ||
    typeof value.assetFileName !== 'string' ||
    value.assetFileName !== basename(value.assetFileName) ||
    !/\.(?:cgf|cga)$/i.test(value.assetFileName)
  ) {
    throw new TypeError('The game data extractor returned an invalid thumbnail asset.')
  }
  return value.assetFileName
}

function thumbnailCachePath(
  cacheDirectory: string,
  fingerprint: string,
  outputClass: string,
  asset: BlueprintRenderAsset
): string {
  const archiveKey = hash(fingerprint).slice(0, 24)
  const identityKey = hash(`${outputClass}\0${asset.path}`).slice(0, 32)
  return join(cacheDirectory, archiveKey, `v${THUMBNAIL_SCHEMA_VERSION}`, `${identityKey}.png`)
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function writeAtomically(path: string, data: Buffer): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, data, { flag: 'wx' })
    await fs.rename(temporaryPath, path)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}

function validatePng(value: Buffer): void {
  if (
    value.length < 33 ||
    value.length > MAX_PNG_BYTES ||
    !value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    value.toString('ascii', 12, 16) !== 'IHDR' ||
    value.readUInt32BE(16) !== 256 ||
    value.readUInt32BE(20) !== 256 ||
    value.indexOf(Buffer.from('IEND', 'ascii')) < 0
  ) {
    throw new TypeError('Generated thumbnail PNG is invalid.')
  }
}

function assertDirectChild(path: string, parent: string): void {
  if (dirname(path).toLowerCase() !== resolve(parent).toLowerCase()) {
    throw new TypeError('Extracted thumbnail asset path is invalid.')
  }
}

function readyResult(png: Buffer, message: string): BlueprintThumbnailResult {
  return {
    status: 'ready',
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    message
  }
}

function result(
  status: Exclude<BlueprintThumbnailResult['status'], 'ready'>,
  message: string
): BlueprintThumbnailResult {
  return { status, dataUrl: null, message }
}

function processErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderr = (error as { stderr?: unknown }).stderr
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
  }
  return error instanceof Error ? error.message : String(error)
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

class ThumbnailUnavailableError extends Error {}

async function sweepTemporaryDirectories(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  const entries = await fs.readdir(root, { withFileTypes: true })
  const failures: unknown[] = []
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('blueprint-thumbnail-'))
      .map(async (entry) => {
        try {
          await removeDirectoryWithRetry(join(root, entry.name))
        } catch (error) {
          failures.push(error)
        }
      })
  )
  if (failures.length > 0) {
    throw new Error(`${failures.length} stale thumbnail director${failures.length === 1 ? 'y' : 'ies'} could not be removed.`, {
      cause: failures[0]
    })
  }
}

async function removeDirectoryWithRetry(path: string): Promise<void> {
  let lastError: unknown
  for (const delay of [0, 100, 300, 700]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      await fs.rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
