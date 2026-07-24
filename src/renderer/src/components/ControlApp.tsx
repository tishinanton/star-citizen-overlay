import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Crosshair,
  Database,
  Download,
  Eye,
  EyeOff,
  Keyboard,
  MapPin,
  Pickaxe,
  RefreshCw,
  RotateCcw,
  Search,
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
  type MiningMaterial,
  type MiningMethod,
  type OverlayPlacement,
  type ShortcutId
} from '../../../shared/contracts'
import { useRockfall } from '../hooks/useRockfall'
import { getAccelerator } from '../lib/shortcut-accelerator'
import { pinSelectedMaterials } from '../lib/material-order'
import SignatureBoard from './SignatureBoard'

type MaterialFilter = 'All' | Exclude<MiningMethod, 'Unclassified'>

const FILTERS: MaterialFilter[] = ['All', 'Ship', 'Ground Vehicle', 'FPS']
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
    setShortcutCapture,
    checkForUpdates,
    restartToUpdate
  } = useRockfall()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MaterialFilter>('All')
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutId | null>(null)

  const visibleMaterials = useMemo(() => {
    if (!snapshot) return []
    const normalizedQuery = query.trim().toLocaleLowerCase()

    return pinSelectedMaterials(
      snapshot.materials,
      snapshot.settings.selectedMaterialIds,
      (material) => {
        const matchesQuery =
          !normalizedQuery ||
          material.name.toLocaleLowerCase().includes(normalizedQuery) ||
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Pickaxe size={20} strokeWidth={1.8} />
          </span>
          <div>
            <strong>Rockfall</strong>
            <span>Mining field console</span>
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

      {(error || snapshot.warning) && (
        <div className="system-warning" role="alert">
          <Zap size={15} />
          {error ?? snapshot.warning}
        </div>
      )}

      <main className="workspace">
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
              onClick={() => void refreshMaterials()}
              disabled={dataStatus.state === 'loading'}
            >
              <RefreshCw
                size={15}
                className={dataStatus.state === 'loading' ? 'is-spinning' : ''}
              />
              Sync
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
              <span>Target</span>
              <span>Method</span>
              <span>Base signature</span>
              <span />
            </div>
            <div className="material-table__body">
              {visibleMaterials.map((material) => {
                const isSelected = settings.selectedMaterialIds.includes(material.id)
                const atLimit = selectedCount >= MAX_SELECTED_MATERIALS && !isSelected

                return (
                  <button
                    className={`material-row ${isSelected ? 'material-row--selected' : ''}`}
                    type="button"
                    role="listitem"
                    key={material.id}
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
                    <strong className="material-signature">
                      {numberFormatter.format(material.signature)}
                    </strong>
                    <span className="row-action">{isSelected ? 'Remove' : 'Arm'}</span>
                  </button>
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

      <footer className="app-footer">
        <span>
          <Database size={13} />
          Star Citizen Wiki provides signature values; UEX has no rock-signature endpoint.
        </span>
        <a href="https://api.star-citizen.wiki/" target="_blank" rel="noreferrer">
          Data source
        </a>
      </footer>
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
  state: 'loading' | 'live' | 'cached' | 'fallback'
  message: string
}): React.JSX.Element {
  const label = {
    loading: 'Syncing',
    live: 'Live data',
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
