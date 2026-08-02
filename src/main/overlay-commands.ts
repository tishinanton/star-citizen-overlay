import type { MiningMaterial, OverlaySettings, OverlaySettingsPatch } from '../shared/contracts'
import type { LanApiErrorCode, LanOverlayCommandV1 } from '../shared/lan-control'

export class OverlayCommandError extends Error {
  constructor(
    readonly code: Extract<LanApiErrorCode, 'catalog_unavailable' | 'item_not_found'>,
    message: string
  ) {
    super(message)
    this.name = 'OverlayCommandError'
  }
}

export interface OverlayCommandResult {
  result: 'applied' | 'noop'
  patch: OverlaySettingsPatch | null
}

export function resolveOverlayCommand(
  command: LanOverlayCommandV1,
  settings: OverlaySettings,
  materials: readonly MiningMaterial[],
  catalogLoading = false
): OverlayCommandResult {
  switch (command.operation) {
    case 'overlay.item.add':
      assertAvailableItem(command.itemId, materials, catalogLoading)
      if (settings.selectedMaterialIds.includes(command.itemId)) return noChange()
      return changed({
        selectedMaterialIds: [...settings.selectedMaterialIds, command.itemId]
      })
    case 'overlay.item.remove':
      assertAvailableItem(command.itemId, materials, catalogLoading)
      if (!settings.selectedMaterialIds.includes(command.itemId)) return noChange()
      return changed({
        selectedMaterialIds: settings.selectedMaterialIds.filter((id) => id !== command.itemId),
        ...(settings.spotlightMaterialId === command.itemId ? { spotlightMaterialId: null } : {})
      })
    case 'overlay.compact.set':
      return settings.compact === command.enabled
        ? noChange()
        : changed({ compact: command.enabled })
    case 'overlay.target.cycle': {
      const selected = settings.selectedMaterialIds
      if (selected.length === 0) {
        return settings.spotlightMaterialId === null
          ? noChange()
          : changed({ spotlightMaterialId: null })
      }
      const currentIndex = settings.spotlightMaterialId
        ? selected.indexOf(settings.spotlightMaterialId)
        : -1
      return changed({
        spotlightMaterialId: selected[(currentIndex + 1) % selected.length]
      })
    }
  }
}

function assertAvailableItem(
  itemId: string,
  materials: readonly MiningMaterial[],
  catalogLoading: boolean
): void {
  if (catalogLoading) {
    throw new OverlayCommandError(
      'catalog_unavailable',
      'Mining targets are still loading on the desktop.'
    )
  }
  if (!materials.some((material) => material.id === itemId)) {
    throw new OverlayCommandError('item_not_found', 'That mining target is not available.')
  }
}

function changed(patch: OverlaySettingsPatch): OverlayCommandResult {
  return { result: 'applied', patch }
}

function noChange(): OverlayCommandResult {
  return { result: 'noop', patch: null }
}
