import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

import {
  DEFAULT_OVERLAY_FONT_SCALE,
  DEFAULT_SHORTCUTS,
  MAX_OVERLAY_FONT_SCALE,
  MAX_CLUSTER_SIZE,
  MAX_SELECTED_MATERIALS,
  MIN_CLUSTER_SIZE,
  MIN_OVERLAY_FONT_SCALE,
  OVERLAY_FONT_SCALE_STEP,
  SHORTCUT_IDS,
  type OverlayPosition,
  type OverlayPlacement,
  type OverlaySettings,
  type OverlaySettingsPatch,
  type ShortcutId
} from '../shared/contracts'

export const SETTINGS_VERSION = 5

export const DEFAULT_SETTINGS: OverlaySettings = {
  selectedMaterialIds: ['agricium-ore', 'laranite-raw', 'riccite-ore'],
  clusterMax: 5,
  visible: true,
  compact: false,
  opacity: 0.58,
  fontScale: DEFAULT_OVERLAY_FONT_SCALE,
  placement: 'top-right',
  customPosition: null,
  spotlightMaterialId: null,
  shortcuts: { ...DEFAULT_SHORTCUTS }
}

const PLACEMENTS: OverlayPlacement[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

export interface LoadedSettings {
  settings: OverlaySettings
  warning: string | null
  needsSave: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPlacement(value: unknown): value is OverlayPlacement {
  return typeof value === 'string' && PLACEMENTS.includes(value as OverlayPlacement)
}

function normalizePosition(value: unknown): OverlayPosition | null {
  if (!isRecord(value)) return null
  if (
    typeof value.x !== 'number' ||
    !Number.isFinite(value.x) ||
    typeof value.y !== 'number' ||
    !Number.isFinite(value.y)
  ) {
    return null
  }

  return {
    x: Math.round(value.x),
    y: Math.round(value.y)
  }
}

function normalizeShortcuts(
  value: unknown,
  fallback: Record<ShortcutId, string>
): Record<ShortcutId, string> {
  if (!isRecord(value)) return { ...fallback }

  const shortcuts = { ...fallback }
  for (const id of SHORTCUT_IDS) {
    const accelerator = value[id]
    if (
      typeof accelerator === 'string' &&
      accelerator.trim().length > 0 &&
      accelerator.trim().length <= 80
    ) {
      shortcuts[id] = accelerator.trim()
    }
  }

  if (new Set(Object.values(shortcuts)).size !== SHORTCUT_IDS.length) {
    throw new RangeError('Each global action must use a different shortcut.')
  }

  return shortcuts
}

export function normalizeSettings(
  value: unknown,
  fallback: OverlaySettings = DEFAULT_SETTINGS
): OverlaySettings {
  if (!isRecord(value)) {
    return { ...fallback, selectedMaterialIds: [...fallback.selectedMaterialIds] }
  }

  const selectedMaterialIds = Array.isArray(value.selectedMaterialIds)
    ? [...new Set(value.selectedMaterialIds.filter((id): id is string => typeof id === 'string'))]
    : [...fallback.selectedMaterialIds]

  if (selectedMaterialIds.length > MAX_SELECTED_MATERIALS) {
    throw new RangeError(`Select no more than ${MAX_SELECTED_MATERIALS} mining targets.`)
  }

  const clusterMax =
    typeof value.clusterMax === 'number' &&
    Number.isInteger(value.clusterMax) &&
    value.clusterMax >= MIN_CLUSTER_SIZE &&
    value.clusterMax <= MAX_CLUSTER_SIZE
      ? value.clusterMax
      : fallback.clusterMax

  const opacity =
    typeof value.opacity === 'number' && Number.isFinite(value.opacity)
      ? Math.min(0.9, Math.max(0.3, value.opacity))
      : fallback.opacity
  const fontScale =
    typeof value.fontScale === 'number' && Number.isFinite(value.fontScale)
      ? Number(
          (
            Math.round(
              Math.min(MAX_OVERLAY_FONT_SCALE, Math.max(MIN_OVERLAY_FONT_SCALE, value.fontScale)) /
                OVERLAY_FONT_SCALE_STEP
            ) * OVERLAY_FONT_SCALE_STEP
          ).toFixed(2)
        )
      : fallback.fontScale

  const spotlightMaterialId =
    typeof value.spotlightMaterialId === 'string' &&
    selectedMaterialIds.includes(value.spotlightMaterialId)
      ? value.spotlightMaterialId
      : null
  const customPosition =
    value.customPosition === null
      ? null
      : (normalizePosition(value.customPosition) ?? fallback.customPosition)
  const shortcuts = normalizeShortcuts(value.shortcuts, fallback.shortcuts)

  return {
    selectedMaterialIds,
    clusterMax,
    visible: typeof value.visible === 'boolean' ? value.visible : fallback.visible,
    compact: typeof value.compact === 'boolean' ? value.compact : fallback.compact,
    opacity,
    fontScale,
    placement: isPlacement(value.placement) ? value.placement : fallback.placement,
    customPosition,
    spotlightMaterialId,
    shortcuts
  }
}

export function parsePersistedSettings(value: unknown): LoadedSettings {
  const settings = normalizeSettings(value)
  const isCurrentVersion = isRecord(value) && value.settingsVersion === SETTINGS_VERSION
  const persistedOpacity =
    isRecord(value) && typeof value.opacity === 'number' ? value.opacity : null
  const usesPreviousDefaultOpacity =
    !isCurrentVersion &&
    persistedOpacity !== null &&
    [0.94, 0.72].some((defaultOpacity) => Math.abs(persistedOpacity - defaultOpacity) < 0.001)

  return {
    settings: usesPreviousDefaultOpacity
      ? { ...settings, opacity: DEFAULT_SETTINGS.opacity }
      : settings,
    warning: null,
    needsSave: !isCurrentVersion
  }
}

export function mergeSettings(
  current: OverlaySettings,
  patch: OverlaySettingsPatch
): OverlaySettings {
  return normalizeSettings({ ...current, ...patch }, current)
}

export async function loadSettings(path: string): Promise<LoadedSettings> {
  try {
    const contents = await fs.readFile(path, 'utf8')
    return parsePersistedSettings(JSON.parse(contents))
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        settings: {
          ...DEFAULT_SETTINGS,
          selectedMaterialIds: [...DEFAULT_SETTINGS.selectedMaterialIds]
        },
        warning: null,
        needsSave: false
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    return {
      settings: {
        ...DEFAULT_SETTINGS,
        selectedMaterialIds: [...DEFAULT_SETTINGS.selectedMaterialIds]
      },
      warning: `Saved settings could not be loaded: ${message}`,
      needsSave: false
    }
  }
}

export async function saveSettings(path: string, settings: OverlaySettings): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify({ settingsVersion: SETTINGS_VERSION, ...settings }, null, 2)}\n`,
    'utf8'
  )
  await fs.rename(temporaryPath, path)
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
