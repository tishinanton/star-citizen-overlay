import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import type { MiningDataResult } from './mining-data'
import { loadBlueprintData, type BlueprintDataResult } from './blueprint-data'
import { loadFactionData, type FactionDataResult } from './faction-data'
import type { GameDataArchive } from './game-data'
import { loadMiningData } from './mining-data'
import {
  createStaticDataPublication,
  type StaticDataPublication,
  type StaticDataPublicationSource
} from './static-data-publication'

export type StaticDataPreparationPhase =
  'validating' | 'signatures' | 'blueprints' | 'factions' | 'packaging' | 'ready'

export interface StaticDataPreparationProgress {
  phase: StaticDataPreparationPhase
  completed: number
  total: number
  message: string
}

export interface PrepareStaticDataOptions {
  gameDataArchive: GameDataArchive
  extractorPath: string
  miningCachePath: string
  blueprintCachePath: string
  factionCachePath: string
  desktopVersion: string
  onProgress?: (progress: StaticDataPreparationProgress) => void
}

export interface PreparedStaticData {
  publication: StaticDataPublication
  source: StaticDataPublicationSource
  mining: MiningDataResult
  blueprints: BlueprintDataResult
  factions: FactionDataResult
  warningCount: number
}

export async function prepareStaticData(
  options: PrepareStaticDataOptions
): Promise<PreparedStaticData> {
  const progress = (phase: StaticDataPreparationPhase, completed: number, message: string): void =>
    options.onProgress?.({ phase, completed, total: 6, message })

  progress('validating', 0, 'Validating the selected Star Citizen build…')
  const source = await readPublicationSource(options.gameDataArchive, options.desktopVersion)

  progress('signatures', 1, 'Refreshing installed mining signatures…')
  const mining = await loadMiningData({
    cachePath: options.miningCachePath,
    extractorPath: options.extractorPath,
    gameDataArchive: options.gameDataArchive,
    forceRefresh: true
  })
  if (mining.status.state !== 'game') {
    throw new Error(
      `Static-data publication requires installed-game signatures. ${mining.status.message}`
    )
  }

  progress('blueprints', 2, 'Refreshing blueprints and packaged icons…')
  const blueprints = await loadBlueprintData({
    cachePath: options.blueprintCachePath,
    extractorPath: options.extractorPath,
    gameDataArchive: options.gameDataArchive,
    forceRefresh: true
  })
  if (blueprints.catalog.state !== 'game') {
    throw new Error(
      `Static-data publication requires installed-game blueprints. ${blueprints.catalog.message}`
    )
  }

  progress('factions', 3, 'Refreshing faction reputation data…')
  const factions = await loadFactionData({
    cachePath: options.factionCachePath,
    extractorPath: options.extractorPath,
    gameDataArchive: options.gameDataArchive,
    forceRefresh: true
  })
  if (factions.state !== 'game') {
    throw new Error(`Static-data publication requires installed-game factions. ${factions.message}`)
  }

  const expectedCatalogVersion = `${source.gameVersion}-${source.channel}`
  const catalogVersions = new Set([blueprints.gameVersion, factions.gameVersion])
  if (catalogVersions.size !== 1 || !catalogVersions.has(expectedCatalogVersion)) {
    throw new Error(
      `Static-data catalogs do not match the selected build (expected ${expectedCatalogVersion}; received ${[
        ...catalogVersions
      ].join(', ')}).`
    )
  }

  progress('packaging', 4, 'Building and hashing the deterministic publication archive…')
  const publication = createStaticDataPublication({
    releaseId: randomUUID(),
    generatedAt: new Date().toISOString(),
    source,
    materials: mining.materials,
    blueprints: Object.values(blueprints.details),
    icons: blueprints.catalog.icons,
    factions: factions.factions
  })
  progress('ready', 6, `Ready to upload ${publication.archive.byteLength.toLocaleString()} bytes.`)
  return {
    publication,
    source,
    mining,
    blueprints,
    factions,
    warningCount: blueprints.warnings.length + factions.warnings.length
  }
}

export async function readPublicationSource(
  archive: GameDataArchive,
  desktopVersion: string
): Promise<StaticDataPublicationSource> {
  const stats = await fs.stat(archive.path)
  if (!stats.isFile() || !Number.isSafeInteger(stats.size) || stats.size <= 0) {
    throw new Error('The selected Star Citizen archive is not a valid file.')
  }
  const manifestPath = join(dirname(archive.path), 'build_manifest.id')
  let value: unknown
  try {
    value = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`The selected game build manifest could not be read: ${errorMessage(error)}`, {
      cause: error
    })
  }
  const data = readRecord(readRecord(value, 'Game build manifest').Data, 'Game build data')
  const gameBuild = readNonEmptyString(data.Branch, 'Game build branch', 200)
  const gameVersion = readNonEmptyString(data.Version, 'Game version', 200)
  return {
    gameBuild,
    gameVersion,
    channel: archive.channel,
    archiveBytes: stats.size,
    archiveModifiedAt: stats.mtime.toISOString(),
    desktopVersion
  }
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function readNonEmptyString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
  return value.trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
