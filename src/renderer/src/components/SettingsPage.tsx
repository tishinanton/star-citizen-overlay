import { Info, RotateCcw, Settings2, Type } from 'lucide-react'

import {
  APP_FONT_SIZE_STEP,
  DEFAULT_APP_FONT_SIZE,
  MAX_APP_FONT_SIZE,
  MIN_APP_FONT_SIZE
} from '../../../shared/contracts'

interface SettingsPageProps {
  fontSize: number
  onFontSizeChange: (fontSize: number) => void
}

export default function SettingsPage({
  fontSize,
  onFontSizeChange
}: SettingsPageProps): React.JSX.Element {
  const scalePercentage = Math.round((fontSize / DEFAULT_APP_FONT_SIZE) * 100)

  return (
    <main
      className="settings-workspace"
      id="panel-settings"
      role="tabpanel"
      aria-labelledby="tab-settings"
    >
      <div className="settings-page">
        <header className="settings-heading">
          <span className="section-icon" aria-hidden="true">
            <Settings2 size={17} />
          </span>
          <div>
            <h1>Settings</h1>
            <p>Adjust Rockfall for comfortable reading without changing its data density.</p>
          </div>
        </header>

        <section className="settings-section" aria-labelledby="appearance-title">
          <div className="settings-section__heading">
            <Type size={18} aria-hidden="true" />
            <div>
              <h2 id="appearance-title">Appearance</h2>
              <p>Text stays at or above your chosen size throughout the app.</p>
            </div>
          </div>

          <div className="font-size-setting">
            <div className="font-size-setting__header">
              <div>
                <label htmlFor="app-font-size">App font size</label>
                <span>Changes apply immediately and are saved automatically.</span>
              </div>
              <output htmlFor="app-font-size" aria-live="polite">
                <strong>{fontSize} px</strong>
                <span>{scalePercentage}%</span>
              </output>
            </div>

            <input
              id="app-font-size"
              type="range"
              min={MIN_APP_FONT_SIZE}
              max={MAX_APP_FONT_SIZE}
              step={APP_FONT_SIZE_STEP}
              value={fontSize}
              aria-valuetext={`${fontSize} pixels, ${scalePercentage}%`}
              onChange={(event) => onFontSizeChange(Number(event.target.value))}
            />
            <div className="font-size-setting__bounds" aria-hidden="true">
              <span>{MIN_APP_FONT_SIZE} px</span>
              <span>{MAX_APP_FONT_SIZE} px</span>
            </div>

            <div className="font-size-preview">
              <span>Live preview</span>
              <strong>Mining targets</strong>
              <p>Signature labels, controls, tables, and status text all scale together.</p>
              <span className="font-size-preview__value">Base signature 4,100</span>
            </div>

            <div className="settings-actions">
              <span>
                <Info size={16} aria-hidden="true" />
                The in-game overlay also keeps its separate text-scale control.
              </span>
              <button
                type="button"
                disabled={fontSize === DEFAULT_APP_FONT_SIZE}
                onClick={() => onFontSizeChange(DEFAULT_APP_FONT_SIZE)}
              >
                <RotateCcw size={14} aria-hidden="true" />
                Reset to {DEFAULT_APP_FONT_SIZE} px
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
