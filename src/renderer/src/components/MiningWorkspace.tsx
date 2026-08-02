import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, FolderOpen, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'

import {
  MAX_SELECTED_MATERIALS,
  type AppSnapshot,
  type MiningLocationResult,
  type MiningMaterial,
  type MiningMethod,
  type OverlaySettingsPatch
} from '../../../shared/contracts'
import type { LanOverlayCommandV1 } from '../../../shared/lan-control'
import { pinSelectedMaterials } from '../lib/material-order'
import MiningLocationPanel from './MiningLocationPanel'

type MaterialFilter = 'All' | Exclude<MiningMethod, 'Unclassified'>

interface LocationLoadState {
  loading: boolean
  result: MiningLocationResult | null
  error: string | null
}

interface MiningWorkspaceProps {
  snapshot: AppSnapshot
  onUpdateSettings: (patch: OverlaySettingsPatch) => Promise<void>
  onExecuteOverlayCommand: (command: LanOverlayCommandV1) => Promise<void>
  onRefreshMaterials: () => Promise<void>
  onChooseGameData: () => Promise<boolean>
  onGetMiningLocations: (materialId: string) => Promise<MiningLocationResult>
}

const FILTERS: MaterialFilter[] = ['All', 'Ship', 'Ground Vehicle', 'FPS']
const numberFormatter = new Intl.NumberFormat('en-US')

export default function MiningWorkspace({
  snapshot,
  onUpdateSettings,
  onExecuteOverlayCommand,
  onRefreshMaterials,
  onChooseGameData,
  onGetMiningLocations
}: MiningWorkspaceProps): React.JSX.Element {
  const { materials, settings, dataStatus } = snapshot
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MaterialFilter>('All')
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(
    () =>
      settings.selectedMaterialIds.find((id) => materials.some((material) => material.id === id)) ??
      materials[0]?.id ??
      null
  )
  const [locationStates, setLocationStates] = useState<Record<string, LocationLoadState>>({})
  const [catalogBusy, setCatalogBusy] = useState(false)
  const locationGeneration = useRef(0)

  const visibleMaterials = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return pinSelectedMaterials(materials, settings.selectedMaterialIds, (material) => {
      const matchesQuery =
        !normalizedQuery ||
        material.name.toLocaleLowerCase().includes(normalizedQuery) ||
        material.id.toLocaleLowerCase().includes(normalizedQuery) ||
        material.signature.toString().includes(normalizedQuery)
      const matchesFilter = filter === 'All' || material.methods.includes(filter)
      return matchesQuery && matchesFilter
    })
  }, [filter, materials, query, settings.selectedMaterialIds])

  const activeMaterial =
    visibleMaterials.find((material) => material.id === activeMaterialId) ??
    visibleMaterials[0] ??
    null
  const activeLocationState = activeMaterial ? locationStates[activeMaterial.id] : undefined
  const selectedCount = settings.selectedMaterialIds.length

  const loadLocations = useCallback(
    async (materialId: string): Promise<void> => {
      const generation = locationGeneration.current
      setLocationStates((current) => ({
        ...current,
        [materialId]: { loading: true, result: null, error: null }
      }))
      try {
        const result = await onGetMiningLocations(materialId)
        if (generation !== locationGeneration.current) return
        setLocationStates((current) => ({
          ...current,
          [materialId]: { loading: false, result, error: null }
        }))
      } catch (reason) {
        if (generation !== locationGeneration.current) return
        setLocationStates((current) => ({
          ...current,
          [materialId]: {
            loading: false,
            result: null,
            error: reason instanceof Error ? reason.message : String(reason)
          }
        }))
      }
    },
    [onGetMiningLocations]
  )

  useEffect(() => {
    if (!activeMaterial || catalogBusy) return
    const state = locationStates[activeMaterial.id]
    if (
      !state ||
      (state.result && state.result.qualityThreshold !== settings.miningQualityThreshold)
    ) {
      void loadLocations(activeMaterial.id)
    }
  }, [activeMaterial, catalogBusy, loadLocations, locationStates, settings.miningQualityThreshold])

  useEffect(() => {
    if (activeMaterial && activeMaterial.id !== activeMaterialId) {
      setActiveMaterialId(activeMaterial.id)
    }
  }, [activeMaterial, activeMaterialId])

  const toggleMaterial = (material: MiningMaterial): void => {
    const isSelected = settings.selectedMaterialIds.includes(material.id)
    void onExecuteOverlayCommand({
      operation: isSelected ? 'overlay.item.remove' : 'overlay.item.add',
      itemId: material.id
    })
  }

  const clearOverlay = (): void => {
    void onUpdateSettings({
      selectedMaterialIds: [],
      spotlightMaterialId: null
    })
  }

  const selectMaterial = (materialId: string): void => {
    setActiveMaterialId(materialId)
  }

  const setFavoriteMiningLocation = (materialId: string, locationId: string | null): void => {
    const favoriteMiningLocationIds = { ...settings.favoriteMiningLocationIds }
    if (locationId) {
      favoriteMiningLocationIds[materialId] = locationId
    } else {
      delete favoriteMiningLocationIds[materialId]
    }
    void onUpdateSettings({ favoriteMiningLocationIds })
  }

  const changeMiningQualityThreshold = async (
    material: MiningMaterial,
    miningQualityThreshold: number
  ): Promise<void> => {
    locationGeneration.current += 1
    setLocationStates({
      [material.id]: { loading: true, result: null, error: null }
    })
    await onUpdateSettings({ miningQualityThreshold })
    await loadLocations(material.id)
  }

  const reloadCatalog = async (action: () => Promise<unknown>): Promise<void> => {
    setCatalogBusy(true)
    locationGeneration.current += 1
    setLocationStates({})
    try {
      await action()
    } finally {
      setCatalogBusy(false)
    }
  }

  const sourceBusy = catalogBusy || dataStatus.state === 'loading'

  return (
    <>
      <section className="mining-pane mining-ore-pane" aria-labelledby="mining-ore-title">
        <header className="mining-pane__header">
          <div className="mining-pane__identity">
            <span className="mining-pane__step" aria-hidden="true">
              1
            </span>
            <div>
              <h1 id="mining-ore-title">Ore</h1>
              <p>Select a material to compare its sites.</p>
            </div>
          </div>
          <div className="ore-selection-summary">
            <span>
              <strong>{selectedCount}</strong> / {MAX_SELECTED_MATERIALS} overlay
            </span>
            <button type="button" disabled={selectedCount === 0} onClick={clearOverlay}>
              <X size={12} aria-hidden="true" />
              Clear
            </button>
          </div>
        </header>

        <div className="ore-tools">
          <div className="ore-filter-deck">
            <label className="ore-search-control" htmlFor="ore-search">
              <span className="ore-control-label">
                <Search size={14} aria-hidden="true" />
                Filter ores
              </span>
              <span className="search-field">
                <Search size={16} aria-hidden="true" />
                <input
                  id="ore-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, ID, or signature"
                />
              </span>
            </label>

            <fieldset className="ore-filter-group">
              <legend>
                <SlidersHorizontal size={14} aria-hidden="true" />
                Mining method
              </legend>
              <div className="filter-strip ore-filter-strip">
                {FILTERS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    className={filter === method ? 'is-active' : ''}
                    aria-pressed={filter === method}
                    onClick={() => setFilter(method)}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="ore-data-actions">
            <button
              className="icon-text-button"
              type="button"
              disabled={sourceBusy}
              onClick={() => void reloadCatalog(onRefreshMaterials)}
            >
              <RefreshCw size={14} className={sourceBusy ? 'is-spinning' : ''} />
              Sync
            </button>
            <button
              className="icon-text-button"
              type="button"
              title="Choose a Star Citizen Data.p4k archive"
              disabled={sourceBusy}
              onClick={() => void reloadCatalog(onChooseGameData)}
            >
              <FolderOpen size={14} />
              Game files
            </button>
          </div>
        </div>

        <div className="ore-list" role="list">
          {visibleMaterials.map((material) => {
            const isActive = activeMaterial?.id === material.id
            const isSelected = settings.selectedMaterialIds.includes(material.id)
            const atLimit = selectedCount >= MAX_SELECTED_MATERIALS && !isSelected

            return (
              <article
                className={[
                  'ore-row',
                  isActive ? 'ore-row--active' : '',
                  isSelected ? 'ore-row--overlay' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                role="listitem"
                key={material.id}
              >
                <button
                  className="ore-row__main"
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  aria-controls={`mining-location-panel-${material.id}`}
                  onClick={() => selectMaterial(material.id)}
                >
                  <span className="ore-row__identity">
                    <strong>{material.name}</strong>
                    <small>
                      {material.methods.join(' / ')} · {material.id}
                    </small>
                  </span>
                  <span className="ore-row__signature" title="Source signature">
                    <small>Signature</small>
                    <strong>{numberFormatter.format(material.signature)}</strong>
                  </span>
                </button>
                <button
                  className={`ore-row__overlay-action ${isSelected ? 'is-active' : ''}`}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${isSelected ? 'Remove' : 'Add'} ${material.name} ${
                    isSelected ? 'from' : 'to'
                  } the overlay`}
                  disabled={atLimit}
                  title={
                    atLimit
                      ? `The overlay supports ${MAX_SELECTED_MATERIALS} ores`
                      : `${isSelected ? 'Remove' : 'Add'} ${material.name} ${
                          isSelected ? 'from' : 'to'
                        } the overlay`
                  }
                  onClick={() => toggleMaterial(material)}
                >
                  <Crosshair size={13} aria-hidden="true" />
                  {isSelected ? 'On' : 'Add'}
                </button>
              </article>
            )
          })}
          {visibleMaterials.length === 0 && (
            <div className="mining-empty">
              <Search size={20} aria-hidden="true" />
              <strong>No matching ores</strong>
              <span>Try another name, signature, or mining method.</span>
            </div>
          )}
        </div>
      </section>

      <MiningLocationPanel
        material={activeMaterial}
        loading={activeLocationState?.loading ?? false}
        result={activeLocationState?.result ?? null}
        error={activeLocationState?.error ?? null}
        favoriteLocationId={
          activeMaterial ? (settings.favoriteMiningLocationIds[activeMaterial.id] ?? null) : null
        }
        qualityThreshold={settings.miningQualityThreshold}
        onFavoriteChange={(locationId) => {
          if (activeMaterial) setFavoriteMiningLocation(activeMaterial.id, locationId)
        }}
        onQualityThresholdChange={(qualityThreshold) => {
          if (activeMaterial) {
            void changeMiningQualityThreshold(activeMaterial, qualityThreshold)
          }
        }}
        onRetry={() => {
          if (activeMaterial) void loadLocations(activeMaterial.id)
        }}
      />
    </>
  )
}
