import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import type { LocalizationSource } from '../shared/contracts'
import type { GameDataArchive } from './game-data'

const PREFERENCE_VERSION = 1

export interface LoadedLocalizationSource {
  source: LocalizationSource
  warning: string | null
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

export function getLooseLocalizationPath(archivePath: string): string {
  return join(dirname(archivePath), 'Data', 'Localization', 'english', 'global.ini')
}

export async function loadLocalizationSource(path: string): Promise<LoadedLocalizationSource> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path, 'utf8'))
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== PREFERENCE_VERSION ||
      !('source' in value) ||
      (value.source !== 'game' && value.source !== 'global-ini')
    ) {
      throw new TypeError('The saved localization source is invalid.')
    }
    return { source: value.source, warning: null }
  } catch (error) {
    if (isMissingFileError(error)) return { source: 'game', warning: null }
    return {
      source: 'game',
      warning: `The saved localization source could not be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

export async function saveLocalizationSource(
  path: string,
  source: LocalizationSource
): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify({ version: PREFERENCE_VERSION, source }, null, 2)}\n`,
    'utf8'
  )
  await fs.rename(temporaryPath, path)
}

export async function validateLocalizationSource(
  source: LocalizationSource,
  archive: GameDataArchive | null
): Promise<void> {
  if (source === 'game') return
  if (!archive) {
    throw new Error('Select a Star Citizen Data.p4k archive before using global.ini.')
  }
  const path = getLooseLocalizationPath(archive.path)
  let stats
  try {
    stats = await fs.stat(path)
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`No installed global.ini was found for ${archive.channel}: ${path}`, {
        cause: error
      })
    }
    throw error
  }
  if (!stats.isFile()) {
    throw new Error(`The selected localization override is not a file: ${path}`)
  }
}
