import { DEFAULT_APP_FONT_SIZE, type OverlaySettings } from './contracts'

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
    settings.appFontSize,
    settings.fontScale,
    settings.compact,
    settings.clusterMax,
    settings.spotlightMaterialId,
    settings.selectedMaterialIds,
    settings.favoriteMiningLocationIds
  ])
}

export function getOverlayFallbackLayout(settings: OverlaySettings): OverlayLayout {
  const effectiveOverlayScale = Math.max(1, settings.fontScale)
  const scaleDimension = (value: number): number =>
    Math.ceil((value * effectiveOverlayScale * settings.appFontSize) / DEFAULT_APP_FONT_SIZE)
  const selectedCount = settings.spotlightMaterialId ? 1 : settings.selectedMaterialIds.length
  const headerHeight = settings.compact ? OVERLAY_COMPACT_HEADER_HEIGHT : OVERLAY_HEADER_HEIGHT

  if (selectedCount === 0) {
    return {
      width: scaleDimension(OVERLAY_BASE_WIDTH),
      height: scaleDimension(OVERLAY_EMPTY_HEIGHT),
      headerHeight: scaleDimension(headerHeight)
    }
  }

  const rowHeight = settings.compact ? OVERLAY_COMPACT_ROW_HEIGHT : OVERLAY_ROW_HEIGHT
  return {
    width: scaleDimension(OVERLAY_BASE_WIDTH),
    height: scaleDimension(headerHeight + selectedCount * rowHeight) + OVERLAY_CHROME_HEIGHT,
    headerHeight: scaleDimension(headerHeight)
  }
}
