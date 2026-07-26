import type { OverlaySettings } from './contracts'

export const OVERLAY_BASE_WIDTH = 420

const OVERLAY_EMPTY_HEIGHT = 160
const OVERLAY_HEADER_HEIGHT = 42
const OVERLAY_COMPACT_HEADER_HEIGHT = 38
const OVERLAY_ROW_HEIGHT = 98
const OVERLAY_COMPACT_ROW_HEIGHT = 92
const OVERLAY_CHROME_HEIGHT = 4

export interface OverlayLayout {
  width: number
  height: number
  headerHeight: number
}

export function getOverlayLayoutKey(settings: OverlaySettings): string {
  return JSON.stringify([
    settings.fontScale,
    settings.compact,
    settings.clusterMax,
    settings.spotlightMaterialId,
    settings.selectedMaterialIds
  ])
}

export function getOverlayFallbackLayout(settings: OverlaySettings): OverlayLayout {
  const scale = settings.fontScale
  const selectedCount = settings.spotlightMaterialId ? 1 : settings.selectedMaterialIds.length
  const headerHeight = settings.compact ? OVERLAY_COMPACT_HEADER_HEIGHT : OVERLAY_HEADER_HEIGHT

  if (selectedCount === 0) {
    return {
      width: Math.ceil(OVERLAY_BASE_WIDTH * scale),
      height: Math.ceil(OVERLAY_EMPTY_HEIGHT * scale),
      headerHeight: Math.ceil(headerHeight * scale)
    }
  }

  const rowHeight = settings.compact ? OVERLAY_COMPACT_ROW_HEIGHT : OVERLAY_ROW_HEIGHT
  return {
    width: Math.ceil(OVERLAY_BASE_WIDTH * scale),
    height: Math.ceil((headerHeight + selectedCount * rowHeight) * scale) + OVERLAY_CHROME_HEIGHT,
    headerHeight: Math.ceil(headerHeight * scale)
  }
}
