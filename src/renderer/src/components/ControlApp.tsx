import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  BookOpen,
  Crosshair,
  Database,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Keyboard,
  MapPin,
  PencilLine,
  Pickaxe,
  RefreshCw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Shield,
  SlidersHorizontal,
  Target,
  X,
  Zap
} from 'lucide-react'

import {
  DEFAULT_SHORTCUTS,
  MAX_OVERLAY_FONT_SCALE,
  MAX_CLUSTER_SIZE,
  MAX_SELECTED_MATERIALS,
  MIN_OVERLAY_FONT_SCALE,
  OVERLAY_FONT_SCALE_STEP,
  type AppUpdateState,
  type DataSourceState,
  type MiningLocationResult,
  type MiningMaterial,
  type MiningMethod,
  type OverlayPlacement,
  type ShortcutId
} from '../../../shared/contracts'
import { resolveMaterialSignature } from '../../../shared/signatures'
import { useRockfall } from '../hooks/useRockfall'
import { getAccelerator } from '../lib/shortcut-accelerator'
import { pinSelectedMaterials } from '../lib/material-order'
import BlueprintBrowser from './BlueprintBrowser'
import FactionBrowser from './FactionBrowser'
import MiningLocationFlyout from './MiningLocationFlyout'
import SettingsPage from './SettingsPage'
import SignatureBoard from './SignatureBoard'
import SignatureOverrideEditor from './SignatureOverrideEditor'

type MaterialFilter = 'All' | Exclude<MiningMethod, 'Unclassified'>
type AppTab = 'mining' | 'blueprints' | 'factions' | 'settings'

interface LocationLoadState {
  loading: boolean
  result: MiningLocationResult | null
  error: string | null
}

interface LocationFlyoutTarget {
  material: MiningMaterial
  anchor: HTMLButtonElement
}

const FILTERS: MaterialFilter[] = ['All', 'Ship', 'Ground Vehicle', 'FPS']
const APP_TABS: AppTab[] = ['mining', 'blueprints', 'factions', 'settings']
const PLACEMENTS: Array<{ value: OverlayPlacement; label: string }> = [
  { value: 'top-right', label: 'Top right' },
  { value: 'top-left', label: 'Top left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' }
]

const numberFormatter = new Intl.NumberFormat('en-US')

export default function ControlApp(): React.JSX.Element {
  const {
    snapshot,
    error,
    updateSettings,
    refreshMaterials,
    chooseGameData,
    getMiningLocations,
    setShortcutCapture,
    beginCloudLogin,
    completeCloudLogin,
    cancelCloudLogin,
    syncCloud,
    confirmCloudProfileImport,
    logoutCloud,
    checkForUpdates,
    restartToUpdate
  } = useRockfall()
  const [activeTab, setActiveTab] = useState<AppTab>('mining')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MaterialFilter>('All')
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutId | null>(null)
  const [locationStates, setLocationStates] = useState<Record<string, LocationLoadState>>({})
  const [locationFlyout, setLocationFlyout] = useState<LocationFlyoutTarget | null>(null)
  const [editingSignatureId, setEditingSignatureId] = useState<string | null>(null)
  const locationGeneration = useRef(0)

  const visibleMaterials = useMemo(() => {
    if (!snapshot) return []
    const normalizedQuery = query.trim().toLocaleLowerCase()

    return pinSelectedMaterials(
      snapshot.materials,
      snapshot.settings.selectedMaterialIds,
      (material) => {
        const resolvedSignature = resolveMaterialSignature(
          material,
          snapshot.settings.signatureOverrides
        ).signature
        const matchesQuery =
          !normalizedQuery ||
          material.name.toLocaleLowerCase().includes(normalizedQuery) ||
          resolvedSignature.toString().includes(normalizedQuery) ||
          material.signature.toString().includes(normalizedQuery)
        const matchesFilter = filter === 'All' || material.methods.includes(filter)
        return matchesQuery && matchesFilter
      }
    )
  }, [filter, query, snapshot])

  if (!snapshot) {
    return (
      <main className="loading-screen">
        <span className="loading-screen__mark">
          <Crosshair size={28} />
        </span>
        <strong>Initializing Rockfall</strong>
        <span>{error ?? 'Loading mining signatures and overlay state…'}</span>
      </main>
    )
  }

  const { settings, dataStatus, shortcuts, appUpdate } = snapshot
  const selectedCount = settings.selectedMaterialIds.length

  const toggleMaterial = (material: MiningMaterial): void => {
    const isSelected = settings.selectedMaterialIds.includes(material.id)
    const selectedMaterialIds = isSelected
      ? settings.selectedMaterialIds.filter((id) => id !== material.id)
      : [...settings.selectedMaterialIds, material.id]

    if (selectedMaterialIds.length <= MAX_SELECTED_MATERIALS) {
      void updateSettings({ selectedMaterialIds })
    }
  }

  const clearOverlay = (): void => {
    void updateSettings({
      selectedMaterialIds: [],
      spotlightMaterialId: null
    })
  }

  const loadLocations = async (material: MiningMaterial): Promise<void> => {
    const generation = locationGeneration.current
    setLocationStates((current) => ({
      ...current,
      [material.id]: { loading: true, result: null, error: null }
    }))
    try {
      const result = await getMiningLocations(material.id)
      if (generation !== locationGeneration.current) return
      setLocationStates((current) => ({
        ...current,
        [material.id]: { loading: false, result, error: null }
      }))
    } catch (reason) {
      if (generation !== locationGeneration.current) return
      setLocationStates((current) => ({
        ...current,
        [material.id]: {
          loading: false,
          result: null,
          error: reason instanceof Error ? reason.message : String(reason)
        }
      }))
    }
  }

  const closeLocations = (restoreFocus: boolean): void => {
    const anchor = locationFlyout?.anchor
    setLocationFlyout(null)
    if (restoreFocus && anchor?.isConnected) {
      requestAnimationFrame(() => anchor.focus())
    }
  }

  const openLocations = (material: MiningMaterial, anchor: HTMLButtonElement): void => {
    if (locationFlyout?.material.id === material.id) {
      closeLocations(false)
      return
    }

    setEditingSignatureId(null)
    setLocationFlyout({ material, anchor })
    const state = locationStates[material.id]
    if (!state || state.error) void loadLocations(material)
  }

  const openSignatureEditor = (materialId: string): void => {
    setLocationFlyout(null)
    setEditingSignatureId((current) => (current === materialId ? null : materialId))
  }

  const saveSignatureOverride = (material: MiningMaterial, signature: number): void => {
    const signatureOverrides = { ...settings.signatureOverrides }
    if (signature === material.signature) {
      delete signatureOverrides[material.id]
    } else {
      signatureOverrides[material.id] = signature
    }

    setEditingSignatureId(null)
    void updateSettings({ signatureOverrides })
  }

  const resetSignatureOverride = (materialId: string): void => {
    const signatureOverrides = { ...settings.signatureOverrides }
    delete signatureOverrides[materialId]
    setEditingSignatureId(null)
    void updateSettings({ signatureOverrides })
  }

  const beginShortcutCapture = (id: ShortcutId): void => {
    setRecordingShortcut(id)
    void setShortcutCapture(true)
  }

  const endShortcutCapture = (): void => {
    setRecordingShortcut(null)
    void setShortcutCapture(false)
  }

  const recordShortcut = (id: ShortcutId, event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (recordingShortcut !== id) return
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      endShortcutCapture()
      return
    }

    const accelerator = getAccelerator(event)
    if (!accelerator) return

    setRecordingShortcut(null)
    void (async () => {
      await updateSettings({
        shortcuts: {
          ...settings.shortcuts,
          [id]: accelerator
        }
      })
      await setShortcutCapture(false)
    })()
  }

  const resetShortcuts = (): void => {
    setRecordingShortcut(null)
    void (async () => {
      await setShortcutCapture(false)
      await updateSettings({ shortcuts: { ...DEFAULT_SHORTCUTS } })
    })()
  }

  const activateTab = (tab: AppTab): void => {
    if (tab === activeTab) return
    setLocationFlyout(null)
    setEditingSignatureId(null)
    if (recordingShortcut) endShortcutCapture()
    setActiveTab(tab)
  }

  const handleTabKeyDown = (tab: AppTab, event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const currentIndex = APP_TABS.indexOf(tab)
    const nextTab =
      event.key === 'Home'
        ? APP_TABS[0]
        : event.key === 'End'
          ? APP_TABS[APP_TABS.length - 1]
          : event.key === 'ArrowLeft'
            ? APP_TABS[(currentIndex - 1 + APP_TABS.length) % APP_TABS.length]
            : event.key === 'ArrowRight'
              ? APP_TABS[(currentIndex + 1) % APP_TABS.length]
              : null
    if (!nextTab) return

    event.preventDefault()
    activateTab(nextTab)
    requestAnimationFrame(() => document.getElementById(`tab-${nextTab}`)?.focus())
  }

  return (
    <div className={`app-shell ${settings.appFontSize >= 18 ? 'app-shell--large-type' : ''}`}>
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Pickaxe size={20} strokeWidth={1.8} />
          </span>
          <div>
            <strong>Rockfall</strong>
            <span>Field operations console</span>
          </div>
        </div>

        <div className="app-header__actions">
          <DataStatus state={dataStatus.state} message={dataStatus.message} />
          <AppUpdateControl
            state={appUpdate}
            onCheck={() => void checkForUpdates()}
            onRestart={() => void restartToUpdate()}
          />
          <button
            className={`overlay-toggle ${settings.visible ? 'overlay-toggle--active' : ''}`}
            type="button"
            onClick={() => void updateSettings({ visible: !settings.visible })}
          >
            {settings.visible ? <Eye size={16} /> : <EyeOff size={16} />}
            Overlay {settings.visible ? 'on' : 'off'}
            <kbd>{formatAccelerator(settings.shortcuts['toggle-overlay'])}</kbd>
          </button>
        </div>
      </header>

      <div className="app-chrome">
        <nav className="app-tabs" role="tablist" aria-label="Rockfall workspaces">
          <button
            id="tab-mining"
            type="button"
            role="tab"
            aria-selected={activeTab === 'mining'}
            aria-controls="panel-mining"
            tabIndex={activeTab === 'mining' ? 0 : -1}
            onClick={() => activateTab('mining')}
            onKeyDown={(event) => handleTabKeyDown('mining', event)}
          >
            <Pickaxe size={15} />
            Mining
          </button>
          <button
            id="tab-blueprints"
            type="button"
            role="tab"
            aria-selected={activeTab === 'blueprints'}
            aria-controls="panel-blueprints"
            tabIndex={activeTab === 'blueprints' ? 0 : -1}
            onClick={() => activateTab('blueprints')}
            onKeyDown={(event) => handleTabKeyDown('blueprints', event)}
          >
            <BookOpen size={15} />
            Blueprints
          </button>
          <button
            id="tab-factions"
            type="button"
            role="tab"
            aria-selected={activeTab === 'factions'}
            aria-controls="panel-factions"
            tabIndex={activeTab === 'factions' ? 0 : -1}
            onClick={() => activateTab('factions')}
            onKeyDown={(event) => handleTabKeyDown('factions', event)}
          >
            <Shield size={15} />
            Factions
          </button>
          <button
            id="tab-settings"
            type="button"
            role="tab"
            aria-selected={activeTab === 'settings'}
            aria-controls="panel-settings"
            tabIndex={activeTab === 'settings' ? 0 : -1}
            onClick={() => activateTab('settings')}
            onKeyDown={(event) => handleTabKeyDown('settings', event)}
          >
            <SettingsIcon size={15} />
            Settings
          </button>
        </nav>

        {(error || snapshot.warning) && (
          <div className="system-warning" role="alert">
            <Zap size={15} />
            {error ?? snapshot.warning}
          </div>
        )}
      </div>

      <main
        className="workspace"
        id="panel-mining"
        role="tabpanel"
        aria-labelledby="tab-mining"
        hidden={activeTab !== 'mining'}
      >
        <section className="target-console" aria-labelledby="targets-title">
          <div className="section-heading">
            <div>
              <span className="section-icon">
                <Target size={17} />
              </span>
              <div>
                <h1 id="targets-title">Mining targets</h1>
                <p>Choose the signatures that belong in your scan reference.</p>
              </div>
            </div>
            <div className="selection-actions">
              <span className="selection-counter">
                <strong>{selectedCount}</strong> / {MAX_SELECTED_MATERIALS} armed
              </span>
              <button
                className="reset-button"
                type="button"
                disabled={selectedCount === 0}
                onClick={clearOverlay}
              >
                <X size={12} />
                Clear overlay
              </button>
            </div>
          </div>

          <div className="target-tools">
            <label className="search-field">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search materials</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search material or signature"
              />
            </label>
            <button
              className="icon-text-button"
              type="button"
              onClick={() => {
                locationGeneration.current += 1
                setLocationStates({})
                setLocationFlyout(null)
                setEditingSignatureId(null)
                void refreshMaterials()
              }}
              disabled={dataStatus.state === 'loading'}
            >
              <RefreshCw
                size={15}
                className={dataStatus.state === 'loading' ? 'is-spinning' : ''}
              />
              Sync
            </button>
            <button
              className="icon-text-button"
              type="button"
              title="Choose a Star Citizen Data.p4k archive"
              onClick={() => {
                locationGeneration.current += 1
                setLocationStates({})
                setLocationFlyout(null)
                setEditingSignatureId(null)
                void chooseGameData()
              }}
              disabled={dataStatus.state === 'loading'}
            >
              <FolderOpen size={15} />
              Game files
            </button>
          </div>

          <div className="filter-strip" aria-label="Filter by mining method">
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

          <div className="material-table" role="list">
            <div className="material-table__header" aria-hidden="true">
              <span className="material-table__selection-columns">
                <span>Target</span>
                <span>Method</span>
                <span>Base signature</span>
              </span>
              <span>Correct</span>
              <span>Places</span>
            </div>
            <div className="material-table__body">
              {visibleMaterials.map((material) => {
                const isSelected = settings.selectedMaterialIds.includes(material.id)
                const atLimit = selectedCount >= MAX_SELECTED_MATERIALS && !isSelected
                const resolvedSignature = resolveMaterialSignature(
                  material,
                  settings.signatureOverrides
                )
                const isEditingSignature = editingSignatureId === material.id

                return (
                  <div
                    className={['material-row', isSelected ? 'material-row--selected' : '']
                      .filter(Boolean)
                      .join(' ')}
                    role="listitem"
                    key={material.id}
                  >
                    <button
                      className="material-row__select"
                      type="button"
                      aria-pressed={isSelected}
                      disabled={atLimit}
                      onClick={() => toggleMaterial(material)}
                    >
                      <span className="material-row__target">
                        <span className="target-checkbox" aria-hidden="true">
                          {isSelected && <span />}
                        </span>
                        <span>
                          <strong>{material.name}</strong>
                          <small>{material.id}</small>
                        </span>
                      </span>
                      <span className="method-label">{material.methods.join(' / ')}</span>
                      <strong
                        className={`material-signature ${
                          resolvedSignature.isOverridden ? 'material-signature--overridden' : ''
                        }`}
                        title={
                          resolvedSignature.isOverridden
                            ? `Manual override; source value ${numberFormatter.format(material.signature)}`
                            : 'Source signature'
                        }
                      >
                        {numberFormatter.format(resolvedSignature.signature)}
                        {resolvedSignature.isOverridden && (
                          <>
                            <span className="signature-override-marker" aria-hidden="true">
                              *
                            </span>
                            <span className="sr-only">
                              {' '}
                              manual override from {numberFormatter.format(material.signature)}
                            </span>
                          </>
                        )}
                      </strong>
                    </button>
                    <button
                      className={`material-row__override ${isEditingSignature ? 'is-active' : ''}`}
                      type="button"
                      aria-label={`Correct signature for ${material.name}`}
                      aria-expanded={isEditingSignature}
                      aria-controls={
                        isEditingSignature ? `signature-override-editor-${material.id}` : undefined
                      }
                      title={`Correct signature for ${material.name}`}
                      onClick={() => openSignatureEditor(material.id)}
                    >
                      <PencilLine size={13} />
                      {resolvedSignature.isOverridden ? 'Edit' : 'Set'}
                    </button>
                    <button
                      className={`material-row__locations ${
                        locationFlyout?.material.id === material.id ? 'is-active' : ''
                      }`}
                      type="button"
                      aria-label={`Show best mining locations for ${material.name}`}
                      aria-expanded={locationFlyout?.material.id === material.id}
                      aria-controls={
                        locationFlyout?.material.id === material.id
                          ? 'mining-location-flyout'
                          : undefined
                      }
                      title={`Best mining locations for ${material.name}`}
                      onClick={(event) => openLocations(material, event.currentTarget)}
                    >
                      <MapPin size={13} />
                      Sites
                    </button>
                    {isEditingSignature && (
                      <SignatureOverrideEditor
                        material={material}
                        signature={resolvedSignature.signature}
                        isOverridden={resolvedSignature.isOverridden}
                        onApply={(signature) => saveSignatureOverride(material, signature)}
                        onCancel={() => setEditingSignatureId(null)}
                        onReset={() => resetSignatureOverride(material.id)}
                      />
                    )}
                  </div>
                )
              })}
              {visibleMaterials.length === 0 && (
                <div className="table-empty">
                  <Search size={20} />
                  <strong>No matching signatures</strong>
                  <span>Try another material name, value, or mining method.</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="overlay-console" aria-labelledby="overlay-title">
          <div className="section-heading section-heading--compact">
            <div>
              <span className="section-icon">
                <Crosshair size={17} />
              </span>
              <div>
                <h2 id="overlay-title">Overlay output</h2>
                <p>Preview mirrors the click-through game overlay.</p>
              </div>
            </div>
          </div>

          <div className="preview-stage">
            <div className="preview-stage__label">
              <span>Live preview</span>
              <span>
                {settings.customPosition ? 'custom position' : settings.placement.replace('-', ' ')}
              </span>
            </div>
            <SignatureBoard snapshot={snapshot} preview />
          </div>

          <div className="control-stack">
            <section className="control-group">
              <div className="control-group__heading">
                <SlidersHorizontal size={15} />
                <div>
                  <strong>Readout</strong>
                  <span>Cluster span and surface density</span>
                </div>
              </div>

              <label className="range-control">
                <span>
                  Cluster size
                  <strong>1–{settings.clusterMax} rocks</strong>
                </span>
                <input
                  type="range"
                  min="2"
                  max={MAX_CLUSTER_SIZE}
                  step="1"
                  value={settings.clusterMax}
                  onChange={(event) =>
                    void updateSettings({ clusterMax: Number(event.target.value) })
                  }
                />
              </label>

              <label className="range-control">
                <span>
                  Font size
                  <strong>{Math.round(settings.fontScale * 100)}%</strong>
                </span>
                <input
                  type="range"
                  min={MIN_OVERLAY_FONT_SCALE * 100}
                  max={MAX_OVERLAY_FONT_SCALE * 100}
                  step={OVERLAY_FONT_SCALE_STEP * 100}
                  value={Math.round(settings.fontScale * 100)}
                  aria-valuetext={`${Math.round(settings.fontScale * 100)}%`}
                  onChange={(event) =>
                    void updateSettings({ fontScale: Number(event.target.value) / 100 })
                  }
                />
              </label>

              <label className="range-control">
                <span>
                  Backdrop opacity
                  <strong>{Math.round(settings.opacity * 100)}%</strong>
                </span>
                <input
                  type="range"
                  min="30"
                  max="90"
                  step="1"
                  value={Math.round(settings.opacity * 100)}
                  onChange={(event) =>
                    void updateSettings({ opacity: Number(event.target.value) / 100 })
                  }
                />
              </label>

              <div className="inline-controls">
                <label className="select-control">
                  <span>
                    <MapPin size={13} />
                    Screen position
                  </span>
                  <small>Drag the overlay header to place it anywhere.</small>
                  <select
                    value={settings.customPosition ? 'custom' : settings.placement}
                    onChange={(event) => {
                      if (event.target.value === 'custom') return
                      void updateSettings({
                        placement: event.target.value as OverlayPlacement,
                        customPosition: null
                      })
                    }}
                  >
                    {settings.customPosition && (
                      <option value="custom" disabled>
                        Custom position
                      </option>
                    )}
                    {PLACEMENTS.map((placement) => (
                      <option key={placement.value} value={placement.value}>
                        {placement.label}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  className={`mode-toggle ${settings.compact ? 'is-active' : ''}`}
                  type="button"
                  aria-pressed={settings.compact}
                  onClick={() => void updateSettings({ compact: !settings.compact })}
                >
                  Compact
                </button>
              </div>
            </section>

            <section className="control-group shortcut-group">
              <div className="control-group__heading control-group__heading--with-action">
                <div className="control-group__title">
                  <Keyboard size={15} />
                  <div>
                    <strong>Global controls</strong>
                    <span>Click a binding, then press its replacement.</span>
                  </div>
                </div>
                <button className="reset-button" type="button" onClick={resetShortcuts}>
                  <RotateCcw size={12} />
                  Reset
                </button>
              </div>
              <div className="shortcut-list">
                {shortcuts.map((shortcut) => (
                  <div className="shortcut-row" key={shortcut.id}>
                    <span
                      className={`shortcut-health ${
                        shortcut.registered ? 'is-registered' : 'is-conflicted'
                      }`}
                      title={shortcut.registered ? 'Registered' : 'Shortcut unavailable'}
                    />
                    <span>{shortcut.label}</span>
                    <button
                      className={`shortcut-binding ${
                        recordingShortcut === shortcut.id ? 'is-recording' : ''
                      }`}
                      type="button"
                      aria-label={`Change ${shortcut.label} shortcut`}
                      onClick={() => beginShortcutCapture(shortcut.id)}
                      onBlur={() => {
                        if (recordingShortcut === shortcut.id) endShortcutCapture()
                      }}
                      onKeyDown={(event) => recordShortcut(shortcut.id, event)}
                    >
                      {recordingShortcut === shortcut.id ? (
                        'Press modifier + key'
                      ) : (
                        <kbd>{formatAccelerator(shortcut.accelerator)}</kbd>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </aside>
      </main>
      {activeTab === 'blueprints' && <BlueprintBrowser />}
      {activeTab === 'factions' && <FactionBrowser />}
      {activeTab === 'settings' && (
        <SettingsPage
          fontSize={settings.appFontSize}
          apiUrl={settings.cloudApiUrl}
          cloud={snapshot.cloud}
          onFontSizeChange={(appFontSize) => void updateSettings({ appFontSize })}
          onApiUrlChange={(cloudApiUrl) => void updateSettings({ cloudApiUrl })}
          onBeginCloudLogin={() => void beginCloudLogin()}
          onCompleteCloudLogin={(handoffCode) => void completeCloudLogin(handoffCode)}
          onCancelCloudLogin={() => void cancelCloudLogin()}
          onSyncCloud={() => void syncCloud()}
          onConfirmCloudProfileImport={() => void confirmCloudProfileImport()}
          onLogoutCloud={() => void logoutCloud()}
        />
      )}

      <footer className="app-footer">
        <span>
          {activeTab === 'settings' ? <SettingsIcon size={13} /> : <Database size={13} />}
          {activeTab === 'mining'
            ? 'Installed game files provide signatures; Star Citizen Wiki provides mining metadata.'
            : activeTab === 'blueprints'
              ? 'Blueprint recipes, item names, icons, and unlock missions come from installed game files.'
              : activeTab === 'factions'
                ? 'Faction profiles, reputation tracks, rank thresholds, drift, and gates come from installed game files.'
                : 'Interface text uses your saved size across Rockfall windows.'}
        </span>
        {activeTab === 'mining' ? (
          <a href="https://api.star-citizen.wiki/" target="_blank" rel="noreferrer">
            Wiki metadata
          </a>
        ) : (
          <span className="app-footer__source">
            {activeTab === 'blueprints' || activeTab === 'factions'
              ? 'Local game data'
              : 'Saved automatically'}
          </span>
        )}
      </footer>

      {activeTab === 'mining' && locationFlyout && (
        <MiningLocationFlyout
          anchor={locationFlyout.anchor}
          material={locationFlyout.material}
          loading={locationStates[locationFlyout.material.id]?.loading ?? true}
          result={locationStates[locationFlyout.material.id]?.result ?? null}
          error={locationStates[locationFlyout.material.id]?.error ?? null}
          onClose={closeLocations}
          onRetry={() => void loadLocations(locationFlyout.material)}
        />
      )}
    </div>
  )
}

function AppUpdateControl({
  state,
  onCheck,
  onRestart
}: {
  state: AppUpdateState
  onCheck: () => void
  onRestart: () => void
}): React.JSX.Element {
  const busy = state.status === 'checking' || state.status === 'downloading'
  const disabled = busy || state.status === 'unavailable'
  const targetVersion = state.availableVersion ? `v${state.availableVersion}` : 'update'
  const label = {
    unavailable: `v${state.currentVersion}`,
    idle: `v${state.currentVersion} · Check updates`,
    checking: 'Checking updates…',
    downloading: `Downloading ${targetVersion} · ${state.downloadProgress ?? 0}%`,
    ready: `Restart for ${targetVersion}`,
    'up-to-date': `v${state.currentVersion} · Up to date`,
    error: 'Update failed · Retry'
  }[state.status]

  return (
    <button
      className={`icon-text-button update-control update-control--${state.status}`}
      type="button"
      disabled={disabled}
      aria-busy={busy}
      aria-label={`${label}. ${state.message}`}
      title={state.message}
      onClick={state.status === 'ready' ? onRestart : onCheck}
    >
      {state.status === 'ready' ? (
        <Download size={14} />
      ) : (
        <RefreshCw size={14} className={busy ? 'is-spinning' : ''} />
      )}
      {label}
    </button>
  )
}

function DataStatus({
  state,
  message
}: {
  state: DataSourceState
  message: string
}): React.JSX.Element {
  const label = {
    loading: 'Syncing',
    game: 'Game data',
    live: 'Wiki data',
    cached: 'Cached data',
    fallback: 'Bundled data'
  }[state]

  return (
    <span className={`data-status data-status--${state}`} title={message}>
      <span />
      {label}
    </span>
  )
}

function formatAccelerator(accelerator: string): string {
  return accelerator
    .replace('CommandOrControl', 'Ctrl')
    .replaceAll('+', ' · ')
    .replace('Right', '→')
    .replace('Left', '←')
}
