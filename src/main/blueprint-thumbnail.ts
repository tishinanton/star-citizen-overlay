import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import type {
  BlueprintDetail,
  BlueprintModelResult,
  BlueprintModelStatus,
  BlueprintThumbnailResult
} from '../shared/contracts'
import { getGameArchiveFingerprint, type GameDataArchive } from './game-data'
import {
  MAX_BLUEPRINT_GLB_BYTES,
  renderGlbThumbnail,
  validateGlbModel
} from './glb-thumbnail-renderer'

const execFileAsync = promisify(execFile)
const MODEL_SCHEMA_VERSION = 2
const MAX_PNG_BYTES = 1024 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

interface ModelGenerationContext {
  blueprint: BlueprintDetail
  archive: GameDataArchive
  temporaryDirectory: string
}

interface Selection {
  key: string
  sequence: number
}

interface PendingModel {
  selection: Selection
  request: Promise<InternalModelResult>
}

interface GenerationJob {
  selection: Selection
  operation: () => Promise<InternalModelResult>
  resolve: (value: InternalModelResult) => void
}

type InternalModelResult = BlueprintModelResult & { cachePath?: string }

export interface BlueprintThumbnailServiceOptions {
  cacheDirectory: string
  temporaryDirectory: string
  extractorPath: string
  converterPath: string
  getGameDataArchive: () => GameDataArchive | null
  generate?: (context: ModelGenerationContext) => Promise<Buffer>
  fingerprint?: (archivePath: string) => Promise<string>
  schemaVersion?: number
  logError?: (message: string, error?: unknown) => void
}

export class BlueprintThumbnailService {
  readonly #options: BlueprintThumbnailServiceOptions
  readonly #pendingModels = new Map<string, PendingModel>()
  readonly #pendingThumbnails = new Map<string, Promise<BlueprintThumbnailResult>>()
  readonly #temporarySweep: Promise<void>
  #converterAvailability: Promise<void> | null = null
  #generationActive = false
  #nextGeneration: GenerationJob | null = null
  #latestSelectionKey = ''
  #latestRequestSequence = 0

  constructor(options: BlueprintThumbnailServiceOptions) {
    this.#options = options
    if (
      options.schemaVersion !== undefined &&
      (!Number.isSafeInteger(options.schemaVersion) || options.schemaVersion < 1)
    ) {
      throw new TypeError('Blueprint model cache schema version must be a positive integer.')
    }
    this.#temporarySweep = sweepTemporaryDirectories(options.temporaryDirectory).catch((error) => {
      ;(options.logError ?? console.error)(
        '[blueprint-model] Stale temporary assets could not be fully removed.',
        error
      )
    })
  }

  async get(blueprint: BlueprintDetail): Promise<BlueprintThumbnailResult> {
    const selection = this.#select(blueprint)
    const unsupported = unsupportedMessage(blueprint)
    if (unsupported) return thumbnailResult('unsupported', unsupported)
    const archive = this.#options.getGameDataArchive()
    if (!archive) {
      return thumbnailResult(
        'unavailable',
        'Select installed Star Citizen game data to generate this thumbnail.'
      )
    }

    const model = await this.#getModelInternal(blueprint, archive, selection)
    if (model.status !== 'ready') {
      return thumbnailResult(model.status, model.message)
    }
    if (!model.bytes) return thumbnailResult('error', 'The generated 3D model contained no data.')
    if (!model.cachePath || !this.#isCurrent(selection)) {
      return thumbnailResult(
        'superseded',
        'Thumbnail generation was superseded by a newer selection.'
      )
    }
    const cachePath = `${model.cachePath.slice(0, -4)}.png`
    const existing = this.#pendingThumbnails.get(cachePath)
    if (existing) return existing
    const request = this.#loadOrRenderThumbnail(blueprint, model.bytes, cachePath).finally(() => {
      if (this.#pendingThumbnails.get(cachePath) === request) {
        this.#pendingThumbnails.delete(cachePath)
      }
    })
    this.#pendingThumbnails.set(cachePath, request)
    return request
  }

  async getModel(blueprint: BlueprintDetail): Promise<BlueprintModelResult> {
    const selection = this.#select(blueprint)
    const unsupported = unsupportedMessage(blueprint)
    if (unsupported) return modelResult('unsupported', unsupported)
    const archive = this.#options.getGameDataArchive()
    if (!archive) {
      return modelResult(
        'unavailable',
        'Select installed Star Citizen game data to generate this 3D preview.'
      )
    }
    const result = await this.#getModelInternal(blueprint, archive, selection)
    if (result.status !== 'ready' || !result.bytes) return result
    return {
      status: 'ready',
      bytes: new Uint8Array(result.bytes),
      stats: result.stats,
      cache: result.cache,
      message: result.message
    }
  }

  #select(blueprint: BlueprintDetail): Selection {
    const asset = blueprint.renderAsset
    const key = `${blueprint.id}\0${blueprint.outputClass}\0${asset?.path ?? ''}`
    if (key !== this.#latestSelectionKey) {
      this.#latestSelectionKey = key
      this.#latestRequestSequence += 1
    }
    return { key, sequence: this.#latestRequestSequence }
  }

  #isCurrent(selection: Selection): boolean {
    return (
      selection.sequence === this.#latestRequestSequence &&
      selection.key === this.#latestSelectionKey
    )
  }

  async #getModelInternal(
    blueprint: BlueprintDetail,
    archive: GameDataArchive,
    selection: Selection
  ): Promise<InternalModelResult> {
    const requestKey = modelRequestKey(blueprint, archive)
    const existing = this.#pendingModels.get(requestKey)
    if (existing) {
      existing.selection = selection
      return existing.request
    }
    const pending = {
      selection,
      request: undefined as unknown as Promise<InternalModelResult>
    }
    pending.request = this.#loadOrGenerateModel(
      blueprint,
      archive,
      () => pending.selection
    ).finally(() => {
      if (this.#pendingModels.get(requestKey) === pending) this.#pendingModels.delete(requestKey)
    })
    this.#pendingModels.set(requestKey, pending)
    return pending.request
  }

  async #loadOrGenerateModel(
    blueprint: BlueprintDetail,
    archive: GameDataArchive,
    getSelection: () => Selection
  ): Promise<InternalModelResult> {
    const cachePath = await this.#cachePath(blueprint, archive)
    if (!cachePath) {
      return modelResult('unavailable', 'The selected Star Citizen archive is unavailable.')
    }
    if (!this.#isCurrent(getSelection())) return supersededModel()

    try {
      const cached = await readBoundedFile(cachePath, MAX_BLUEPRINT_GLB_BYTES)
      const stats = validateGlbModel(cached)
      if (!this.#isCurrent(getSelection())) return supersededModel()
      return {
        status: 'ready',
        bytes: cached,
        stats,
        cache: 'disk',
        cachePath,
        message: 'Loaded a validated 3D model from the local installed-game cache.'
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.#log(blueprint, 'Cached 3D model was invalid or unreadable; regenerating it.', error)
      }
    }

    return this.#enqueueGeneration(getSelection, async () => {
      await this.#temporarySweep
      await fs.mkdir(this.#options.temporaryDirectory, { recursive: true })
      const temporaryDirectory = await fs.mkdtemp(
        join(this.#options.temporaryDirectory, 'blueprint-model-')
      )
      try {
        const glb = await (this.#options.generate ?? ((context) => this.#generateModel(context)))({
          blueprint,
          archive,
          temporaryDirectory
        })
        const stats = validateGlbModel(glb)
        let cacheWarning = ''
        try {
          await writeAtomically(cachePath, glb)
        } catch (error) {
          cacheWarning = ' The local model cache could not be updated.'
          this.#log(blueprint, 'Generated 3D model could not be cached.', error)
        }
        return {
          status: 'ready',
          bytes: glb,
          stats,
          cache: 'generated',
          cachePath,
          message: `Generated a validated 3D model from installed-game geometry.${cacheWarning}`
        }
      } catch (error) {
        if (error instanceof ModelUnavailableError) {
          this.#log(blueprint, error.message)
          return modelResult('unavailable', error.message)
        }
        this.#log(blueprint, '3D model generation failed.', error)
        return modelResult(
          'error',
          `Local 3D model generation failed: ${error instanceof Error ? error.message : String(error)}`
        )
      } finally {
        try {
          await removeDirectoryWithRetry(temporaryDirectory)
        } catch (error) {
          this.#log(blueprint, 'Temporary 3D model assets could not be removed.', error)
        }
      }
    })
  }

  async #cachePath(blueprint: BlueprintDetail, archive: GameDataArchive): Promise<string | null> {
    let fingerprint: string
    try {
      fingerprint = await (this.#options.fingerprint ?? getGameArchiveFingerprint)(archive.path)
    } catch (error) {
      this.#log(blueprint, 'Archive fingerprint could not be read.', error)
      return null
    }
    const asset = blueprint.renderAsset
    if (!asset) return null
    const archiveKey = hash(fingerprint).slice(0, 24)
    const identityKey = hash(`${blueprint.outputClass}\0${asset.path}`).slice(0, 32)
    const schema = this.#options.schemaVersion ?? MODEL_SCHEMA_VERSION
    return join(this.#options.cacheDirectory, archiveKey, `v${schema}`, `${identityKey}.glb`)
  }

  async #loadOrRenderThumbnail(
    blueprint: BlueprintDetail,
    glb: Uint8Array,
    cachePath: string
  ): Promise<BlueprintThumbnailResult> {
    try {
      const cached = await readBoundedFile(cachePath, MAX_PNG_BYTES)
      validatePng(cached)
      return readyThumbnail(cached, 'Generated locally from cached installed-game geometry.')
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.#log(blueprint, 'Cached thumbnail could not be read; regenerating it.', error)
      }
    }

    try {
      const png = await renderGlbThumbnail(
        Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength),
        256
      )
      validatePng(png)
      let cacheWarning = ''
      try {
        await writeAtomically(cachePath, png)
      } catch (error) {
        cacheWarning = ' The local thumbnail cache could not be updated.'
        this.#log(blueprint, 'Generated thumbnail could not be cached.', error)
      }
      return readyThumbnail(png, `Generated locally from installed-game geometry.${cacheWarning}`)
    } catch (error) {
      this.#log(blueprint, 'Thumbnail rendering failed.', error)
      return thumbnailResult(
        'error',
        `Local thumbnail rendering failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async #generateModel(context: ModelGenerationContext): Promise<Buffer> {
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
        [context.archive.path, 'thumbnail-asset', asset.path, extractionDirectory],
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
        [sourcePath, '-glb', '-notex', '-out', conversionDirectory, '-loglevel', 'error'],
        {
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          timeout: 180_000,
          windowsHide: true
        }
      )
    } catch (error) {
      if (isMissingFileError(error)) throw converterUnavailable()
      throw new Error(`Game geometry conversion failed: ${processErrorMessage(error)}`, {
        cause: error
      })
    }

    const glbPath = join(
      conversionDirectory,
      `${basename(assetFileName, extname(assetFileName))}.glb`
    )
    return readBoundedFile(glbPath, MAX_BLUEPRINT_GLB_BYTES)
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
        if (isMissingFileError(error)) throw converterUnavailable()
        if (
          typeof error === 'object' &&
          error !== null &&
          'stdout' in error &&
          typeof (error as { stdout?: unknown }).stdout === 'string' &&
          (error as { stdout: string }).stdout.includes('CryEngine Converter v2.')
        ) {
          return
        }
        throw new ModelUnavailableError(
          `Cryengine Converter is unavailable: ${processErrorMessage(error)}`,
          { cause: error }
        )
      })
    return this.#converterAvailability
  }

  #enqueueGeneration(
    getSelection: () => Selection,
    operation: () => Promise<InternalModelResult>
  ): Promise<InternalModelResult> {
    return new Promise((resolve) => {
      const job = { selection: getSelection(), operation, resolve }
      if (!this.#isCurrent(job.selection)) {
        resolve(supersededModel())
      } else if (!this.#generationActive) {
        this.#generationActive = true
        void this.#runGeneration(job)
      } else {
        this.#nextGeneration?.resolve(supersededModel())
        this.#nextGeneration = job
      }
    })
  }

  async #runGeneration(job: GenerationJob): Promise<void> {
    try {
      job.resolve(await job.operation())
    } catch (error) {
      job.resolve(
        modelResult(
          'error',
          `Local 3D model generation failed: ${error instanceof Error ? error.message : String(error)}`
        )
      )
    } finally {
      const next = this.#nextGeneration
      this.#nextGeneration = null
      if (next && this.#isCurrent(next.selection)) {
        void this.#runGeneration(next)
      } else {
        next?.resolve(supersededModel())
        this.#generationActive = false
      }
    }
  }

  #log(blueprint: BlueprintDetail, message: string, error?: unknown): void {
    ;(this.#options.logError ?? console.error)(
      `[blueprint-model:${blueprint.outputClass}] ${message}`,
      error
    )
  }
}

export function validateBlueprintRequestId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 200 ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)
  ) {
    throw new TypeError('A valid blueprint is required.')
  }
  return value
}

function unsupportedMessage(blueprint: BlueprintDetail): string | null {
  const asset = blueprint.renderAsset
  if (!asset) return 'This output does not reference a renderable game asset.'
  if (asset.format === 'skin' || asset.format === 'chr') {
    return `Skinned ${asset.format.toUpperCase()} assets are not supported by the local 3D preview.`
  }
  if (asset.format !== 'cgf' && asset.format !== 'cga') {
    return `Geometry format ${asset.format} is not supported.`
  }
  return null
}

function modelRequestKey(blueprint: BlueprintDetail, archive: GameDataArchive): string {
  return `${archive.path}\0${blueprint.outputClass}\0${blueprint.renderAsset?.path ?? ''}`
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

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<Buffer> {
  const metadata = await fs.stat(path)
  if (!metadata.isFile() || metadata.size > maximumBytes) {
    throw new RangeError(`Cached asset exceeds the ${maximumBytes} byte limit.`)
  }
  const value = await fs.readFile(path)
  if (value.length > maximumBytes) throw new RangeError('Cached asset exceeds its size limit.')
  return value
}

async function writeAtomically(path: string, data: Uint8Array): Promise<void> {
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

function readyThumbnail(png: Buffer, message: string): BlueprintThumbnailResult {
  return {
    status: 'ready',
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    message
  }
}

function thumbnailResult(
  status: Exclude<BlueprintThumbnailResult['status'], 'ready'>,
  message: string
): BlueprintThumbnailResult {
  return { status, dataUrl: null, message }
}

function modelResult(
  status: Exclude<BlueprintModelStatus, 'ready'>,
  message: string
): BlueprintModelResult {
  return { status, bytes: null, stats: null, cache: null, message }
}

function supersededModel(): BlueprintModelResult {
  return modelResult('superseded', '3D model generation was superseded by a newer selection.')
}

function converterUnavailable(): ModelUnavailableError {
  return new ModelUnavailableError(
    'Install Cryengine Converter 2.0 or configure ROCKFALL_CGF_CONVERTER to enable local 3D previews.'
  )
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

class ModelUnavailableError extends Error {}

async function sweepTemporaryDirectories(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  const entries = await fs.readdir(root, { withFileTypes: true })
  const failures: unknown[] = []
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name.startsWith('blueprint-model-') ||
            entry.name.startsWith('blueprint-thumbnail-'))
      )
      .map(async (entry) => {
        try {
          await removeDirectoryWithRetry(join(root, entry.name))
        } catch (error) {
          failures.push(error)
        }
      })
  )
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} stale blueprint asset director${failures.length === 1 ? 'y' : 'ies'} could not be removed.`,
      { cause: failures[0] }
    )
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
