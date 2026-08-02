import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Crosshair, Keyboard, MapPin, RotateCcw, SlidersHorizontal } from 'lucide-react'

import {
  DEFAULT_SHORTCUTS,
  MAX_CLUSTER_SIZE,
  MAX_OVERLAY_FONT_SCALE,
  MIN_OVERLAY_FONT_SCALE,
  OVERLAY_FONT_SCALE_STEP,
  type AppSnapshot,
  type OverlayPlacement,
  type OverlaySettingsPatch,
  type ShortcutId
} from '../../../shared/contracts'
import type { LanOverlayCommandV1 } from '../../../shared/lan-control'
import { formatAccelerator, getAccelerator } from '../lib/shortcut-accelerator'
import SignatureBoard from './SignatureBoard'

interface OverlaySettingsProps {
  snapshot: AppSnapshot
  onUpdateSettings: (patch: OverlaySettingsPatch) => Promise<void>
  onExecuteOverlayCommand: (command: LanOverlayCommandV1) => Promise<void>
  onSetShortcutCapture: (active: boolean) => Promise<void>
}

const PLACEMENTS: Array<{ value: OverlayPlacement; label: string }> = [
  { value: 'top-right', label: 'Top right' },
  { value: 'top-left', label: 'Top left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' }
]

export default function OverlaySettings({
  snapshot,
  onUpdateSettings,
  onExecuteOverlayCommand,
  onSetShortcutCapture
}: OverlaySettingsProps): React.JSX.Element {
  const { settings, shortcuts } = snapshot
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutId | null>(null)
  const recordingShortcutRef = useRef<ShortcutId | null>(null)

  useEffect(() => {
    recordingShortcutRef.current = recordingShortcut
  }, [recordingShortcut])

  useEffect(
    () => () => {
      if (recordingShortcutRef.current) void onSetShortcutCapture(false)
    },
    [onSetShortcutCapture]
  )

  const beginShortcutCapture = (id: ShortcutId): void => {
    setRecordingShortcut(id)
    void onSetShortcutCapture(true)
  }

  const endShortcutCapture = (): void => {
    setRecordingShortcut(null)
    void onSetShortcutCapture(false)
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
      await onUpdateSettings({
        shortcuts: {
          ...settings.shortcuts,
          [id]: accelerator
        }
      })
      await onSetShortcutCapture(false)
    })()
  }

  const resetShortcuts = (): void => {
    setRecordingShortcut(null)
    void (async () => {
      await onSetShortcutCapture(false)
      await onUpdateSettings({ shortcuts: { ...DEFAULT_SHORTCUTS } })
    })()
  }

  return (
    <section
      className="settings-section settings-section--overlay"
      id="settings-overlay"
      aria-labelledby="overlay-settings-title"
    >
      <div className="settings-section__heading">
        <Crosshair size={18} aria-hidden="true" />
        <div>
          <h2 id="overlay-settings-title">In-game overlay</h2>
          <p>Preview the scan reference and tune how it appears over the game.</p>
        </div>
      </div>

      <div className="overlay-settings">
        <div className="preview-stage">
          <div className="preview-stage__label">
            <span>Live preview</span>
            <span>
              {settings.customPosition ? 'custom position' : settings.placement.replace('-', ' ')}
            </span>
          </div>
          <SignatureBoard snapshot={snapshot} preview />
        </div>

        <div className="overlay-settings__controls">
          <section className="control-group">
            <div className="control-group__heading">
              <SlidersHorizontal size={15} />
              <div>
                <strong>Readout</strong>
                <span>Density, scale, and placement</span>
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
                  void onUpdateSettings({ clusterMax: Number(event.target.value) })
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
                  void onUpdateSettings({ fontScale: Number(event.target.value) / 100 })
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
                  void onUpdateSettings({ opacity: Number(event.target.value) / 100 })
                }
              />
            </label>

            <div className="inline-controls">
              <label className="select-control">
                <span>
                  <MapPin size={13} />
                  Screen position
                </span>
                <small>Drag the overlay header for a custom position.</small>
                <select
                  value={settings.customPosition ? 'custom' : settings.placement}
                  onChange={(event) => {
                    if (event.target.value === 'custom') return
                    void onUpdateSettings({
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
                onClick={() =>
                  void onExecuteOverlayCommand({
                    operation: 'overlay.compact.set',
                    enabled: !settings.compact
                  })
                }
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
                  <span>Select a binding, then press its replacement.</span>
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
      </div>
    </section>
  )
}
