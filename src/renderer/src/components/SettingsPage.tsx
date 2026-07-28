import { useState, type FormEvent } from 'react'
import {
  Cloud,
  Info,
  Link,
  LogIn,
  LogOut,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Type,
  X
} from 'lucide-react'

import {
  APP_FONT_SIZE_STEP,
  DEFAULT_APP_FONT_SIZE,
  MAX_APP_FONT_SIZE,
  MIN_APP_FONT_SIZE,
  type CloudSyncState
} from '../../../shared/contracts'

interface SettingsPageProps {
  fontSize: number
  apiUrl: string
  cloud: CloudSyncState
  onFontSizeChange: (fontSize: number) => void
  onApiUrlChange: (apiUrl: string) => void
  onBeginCloudLogin: () => void
  onCompleteCloudLogin: (handoffCode: string) => void
  onCancelCloudLogin: () => void
  onSyncCloud: () => void
  onConfirmCloudProfileImport: () => void
  onLogoutCloud: () => void
}

export default function SettingsPage({
  fontSize,
  apiUrl,
  cloud,
  onFontSizeChange,
  onApiUrlChange,
  onBeginCloudLogin,
  onCompleteCloudLogin,
  onCancelCloudLogin,
  onSyncCloud,
  onConfirmCloudProfileImport,
  onLogoutCloud
}: SettingsPageProps): React.JSX.Element {
  const scalePercentage = Math.round((fontSize / DEFAULT_APP_FONT_SIZE) * 100)
  const [apiUrlDraft, setApiUrlDraft] = useState<string | null>(null)
  const [handoffDraft, setHandoffDraft] = useState<{
    loginExpiresAt: string | null
    value: string
  }>({ loginExpiresAt: null, value: '' })
  const waitingForBrowser = cloud.status === 'waiting-for-browser'
  const busy = ['connecting', 'restoring', 'syncing'].includes(cloud.status)
  const displayedApiUrl = apiUrlDraft ?? apiUrl
  const handoffCode = handoffDraft.loginExpiresAt === cloud.loginExpiresAt ? handoffDraft.value : ''
  const endpointChanged = apiUrlDraft !== null && apiUrlDraft.trim() !== apiUrl

  const saveApiUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (endpointChanged) {
      onApiUrlChange(apiUrlDraft.trim())
      setApiUrlDraft(null)
    }
  }

  const completeLogin = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (handoffCode.trim()) {
      onCompleteCloudLogin(handoffCode.trim())
      setHandoffDraft({ loginExpiresAt: cloud.loginExpiresAt, value: '' })
    }
  }

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
            <p>Control Rockfall&apos;s display, cloud connection, and local service endpoint.</p>
          </div>
        </header>

        <section className="settings-section" aria-labelledby="cloud-sync-title">
          <div className="settings-section__heading">
            <Cloud size={18} aria-hidden="true" />
            <div>
              <h2 id="cloud-sync-title">Cloud sync</h2>
              <p>Keep log receipts and manual blueprint marks consistent across PCs.</p>
            </div>
          </div>

          <div className="cloud-settings">
            <div className="cloud-connection__header">
              <div>
                <span className="setting-label">
                  {cloud.user ? cloud.user.displayName : 'Discord account'}
                </span>
                <span className="setting-help" role="status" aria-live="polite">
                  {cloud.message}
                </span>
              </div>
              <CloudStatus status={cloud.status} />
            </div>

            <dl className="cloud-telemetry">
              <div>
                <dt>Last sync</dt>
                <dd>{formatSyncTime(cloud.lastSyncedAt)}</dd>
              </div>
              <div>
                <dt>Queue</dt>
                <dd>{cloud.pendingOperationCount} pending</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>
                  {cloud.user
                    ? cloud.refreshTokenPersistent
                      ? 'Windows protected'
                      : 'This run only'
                    : 'Not connected'}
                </dd>
              </div>
            </dl>

            {cloud.quarantinedOperationCount > 0 && (
              <div className="cloud-notice cloud-notice--danger" role="alert">
                <TriangleAlert size={16} aria-hidden="true" />
                <span>
                  {cloud.quarantinedOperationCount} rejected sync operation
                  {cloud.quarantinedOperationCount === 1 ? '' : 's'} were isolated so later changes
                  can continue.
                </span>
              </div>
            )}

            {cloud.blockedProfileCount > 0 && (
              <div className="cloud-notice cloud-notice--warning">
                <TriangleAlert size={16} aria-hidden="true" />
                <span>
                  {cloud.blockedProfileCount} local profile
                  {cloud.blockedProfileCount === 1 ? ' is' : 's are'} linked to another Discord
                  account.
                </span>
                <button type="button" disabled={busy} onClick={onConfirmCloudProfileImport}>
                  Review import
                </button>
              </div>
            )}

            <div className="cloud-actions">
              {cloud.user ? (
                <>
                  <button type="button" disabled={busy} onClick={onSyncCloud}>
                    <RefreshCw
                      size={15}
                      aria-hidden="true"
                      className={cloud.status === 'syncing' ? 'is-spinning' : ''}
                    />
                    Sync now
                  </button>
                  <button
                    className="cloud-actions__secondary"
                    type="button"
                    disabled={busy}
                    onClick={onLogoutCloud}
                  >
                    <LogOut size={15} aria-hidden="true" />
                    Sign out
                  </button>
                </>
              ) : waitingForBrowser ? (
                <button
                  className="cloud-actions__secondary"
                  type="button"
                  onClick={() => {
                    setHandoffDraft({ loginExpiresAt: null, value: '' })
                    onCancelCloudLogin()
                  }}
                >
                  <X size={15} aria-hidden="true" />
                  Cancel sign-in
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={onBeginCloudLogin}>
                  <LogIn size={15} aria-hidden="true" />
                  Sign in with Discord
                </button>
              )}
            </div>

            {waitingForBrowser && (
              <form className="handoff-form" onSubmit={completeLogin}>
                <div>
                  <label htmlFor="discord-handoff-code">Browser handoff code</label>
                  <span>
                    Rockfall normally receives this automatically. Paste the one-time code only if
                    the browser could not reopen the app.
                  </span>
                </div>
                <div className="inline-field">
                  <input
                    id="discord-handoff-code"
                    type="password"
                    autoComplete="one-time-code"
                    value={handoffCode}
                    onChange={(event) =>
                      setHandoffDraft({
                        loginExpiresAt: cloud.loginExpiresAt,
                        value: event.target.value
                      })
                    }
                    placeholder="Paste one-time code"
                  />
                  <button type="submit" disabled={!handoffCode.trim()}>
                    Complete
                  </button>
                </div>
              </form>
            )}

            <form className="api-endpoint-form" onSubmit={saveApiUrl}>
              <div className="api-endpoint-form__heading">
                <Link size={16} aria-hidden="true" />
                <div>
                  <label htmlFor="cloud-api-url">Cloud API URL</label>
                  <span>
                    Use the service root. A local Swagger or OpenAPI URL is normalized
                    automatically.
                  </span>
                </div>
              </div>
              <div className="inline-field">
                <input
                  id="cloud-api-url"
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  value={displayedApiUrl}
                  disabled={busy}
                  onChange={(event) => setApiUrlDraft(event.target.value)}
                  placeholder="https://localhost:7065"
                />
                <button
                  type="submit"
                  disabled={busy || !endpointChanged || !displayedApiUrl.trim()}
                >
                  Apply
                </button>
              </div>
              <span className="api-endpoint-form__note">
                <ShieldCheck size={15} aria-hidden="true" />
                Changing endpoints signs out the current cloud session. Self-signed certificates are
                accepted only for loopback development URLs.
              </span>
            </form>
          </div>
        </section>

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

function CloudStatus({ status }: { status: CloudSyncState['status'] }): React.JSX.Element {
  const label =
    status === 'signed-out'
      ? 'Signed out'
      : status === 'waiting-for-browser'
        ? 'Browser authorization'
        : status === 'auth-expired'
          ? 'Sign-in expired'
          : status === 'offline'
            ? 'Offline'
            : status === 'error'
              ? 'Sync error'
              : status === 'synced'
                ? 'Synced'
                : status === 'syncing'
                  ? 'Syncing'
                  : status === 'restoring'
                    ? 'Restoring'
                    : 'Connecting'
  return (
    <span className={`cloud-status cloud-status--${status}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  )
}

function formatSyncTime(timestamp: string | null): string {
  if (!timestamp) return 'Never'
  const value = new Date(timestamp)
  if (!Number.isFinite(value.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(value)
}
