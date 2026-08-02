import { useState, type FormEvent } from 'react'
import {
  Cloud,
  Database,
  ExternalLink,
  FolderOpen,
  Info,
  Languages,
  Link,
  LogIn,
  LogOut,
  Monitor,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Type,
  X
} from 'lucide-react'

import {
  APP_FONT_SIZE_STEP,
  DEFAULT_APP_FONT_SIZE,
  MAX_APP_FONT_SIZE,
  MIN_APP_FONT_SIZE,
  type AppSnapshot,
  type CloudSyncState,
  type OverlaySettingsPatch,
  type StarStringsSyncState,
  type StaticDataSyncState
} from '../../../shared/contracts'
import type {
  LanControlConfig,
  LanControlState,
  LanOverlayCommandV1,
  LanPairingSession
} from '../../../shared/lan-control'
import { canShowAdminCloudSettings } from '../lib/cloud-admin-visibility'
import LanControlSettings from './LanControlSettings'
import OverlaySettings from './OverlaySettings'

interface SettingsPageProps {
  snapshot: AppSnapshot
  fontSize: number
  apiUrl: string
  lanConfig: LanControlConfig
  lanState: LanControlState
  cloud: CloudSyncState
  staticData: StaticDataSyncState
  starStrings: StarStringsSyncState
  gameDataSyncing: boolean
  onFontSizeChange: (fontSize: number) => void
  onApiUrlChange: (apiUrl: string) => void
  onConfigureLanControl: (config: LanControlConfig) => Promise<void>
  onBeginLanPairing: () => Promise<LanPairingSession | null>
  onCancelLanPairing: () => Promise<void>
  onRevokeLanClient: (clientId: string) => Promise<void>
  onResetLanIdentity: () => Promise<void>
  onUpdateSettings: (patch: OverlaySettingsPatch) => Promise<void>
  onExecuteOverlayCommand: (command: LanOverlayCommandV1) => Promise<void>
  onSetShortcutCapture: (active: boolean) => Promise<void>
  onBeginCloudLogin: () => void
  onCompleteCloudLogin: (handoffCode: string) => void
  onCancelCloudLogin: () => void
  onSyncCloud: () => void
  onConfirmCloudProfileImport: () => void
  onLogoutCloud: () => void
  onPublishStaticData: () => void
  onSyncStarStrings: () => void
  onChooseGameData: () => void
}

export default function SettingsPage({
  snapshot,
  fontSize,
  apiUrl,
  lanConfig,
  lanState,
  cloud,
  staticData,
  starStrings,
  gameDataSyncing,
  onFontSizeChange,
  onApiUrlChange,
  onConfigureLanControl,
  onBeginLanPairing,
  onCancelLanPairing,
  onRevokeLanClient,
  onResetLanIdentity,
  onUpdateSettings,
  onExecuteOverlayCommand,
  onSetShortcutCapture,
  onBeginCloudLogin,
  onCompleteCloudLogin,
  onCancelCloudLogin,
  onSyncCloud,
  onConfirmCloudProfileImport,
  onLogoutCloud,
  onPublishStaticData,
  onSyncStarStrings,
  onChooseGameData
}: SettingsPageProps): React.JSX.Element {
  const scalePercentage = Math.round((fontSize / DEFAULT_APP_FONT_SIZE) * 100)
  const [apiUrlDraft, setApiUrlDraft] = useState<string | null>(null)
  const [handoffDraft, setHandoffDraft] = useState<{
    loginExpiresAt: string | null
    value: string
  }>({ loginExpiresAt: null, value: '' })
  const waitingForBrowser = cloud.status === 'waiting-for-browser'
  const busy = ['connecting', 'restoring', 'syncing'].includes(cloud.status)
  const staticDataBusy = [
    'checking',
    'preparing',
    'confirming',
    'uploading',
    'validating'
  ].includes(staticData.status)
  const starStringsBusy = ['checking', 'downloading', 'installing'].includes(starStrings.status)
  const gameDataBusy = gameDataSyncing || snapshot.dataStatus.state === 'loading'
  const gameDataInteractionBusy = gameDataBusy || staticDataBusy || starStringsBusy
  const interactionBusy = busy || staticDataBusy
  const showAdminCloudSettings = canShowAdminCloudSettings(cloud)
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
            <p>
              Control the in-game overlay, phone pairing, cloud connection, and game integrations.
            </p>
          </div>
        </header>

        <div className="settings-console">
          <nav className="settings-index" aria-label="Settings sections">
            <a href="#settings-game-data">
              <FolderOpen size={16} aria-hidden="true" />
              <span>
                <strong>Game files</strong>
                <small>Archive source</small>
              </span>
            </a>
            <a href="#settings-cloud-sync">
              <Cloud size={16} aria-hidden="true" />
              <span>
                <strong>Cloud sync</strong>
                <small>Account state</small>
              </span>
            </a>
            {showAdminCloudSettings && (
              <a href="#settings-static-data">
                <Database size={16} aria-hidden="true" />
                <span>
                  <strong>Static data</strong>
                  <small>Mobile catalog</small>
                </span>
              </a>
            )}
            <a href="#settings-starstrings">
              <Languages size={16} aria-hidden="true" />
              <span>
                <strong>StarStrings</strong>
                <small>Localization</small>
              </span>
            </a>
            <a href="#settings-appearance">
              <Type size={16} aria-hidden="true" />
              <span>
                <strong>Appearance</strong>
                <small>Interface scale</small>
              </span>
            </a>
            <a href="#settings-overlay">
              <Monitor size={16} aria-hidden="true" />
              <span>
                <strong>In-game overlay</strong>
                <small>Display & shortcuts</small>
              </span>
            </a>
            <a href="#settings-phone-control">
              <Smartphone size={16} aria-hidden="true" />
              <span>
                <strong>Phone control</strong>
                <small>LAN pairing</small>
              </span>
            </a>
          </nav>

          <div className="settings-console__content">
            <section
              className="settings-section"
              id="settings-game-data"
              aria-labelledby="game-data-title"
            >
              <div className="settings-section__heading">
                <FolderOpen size={18} aria-hidden="true" />
                <div>
                  <h2 id="game-data-title">Game files</h2>
                  <p>Set the local Data.p4k archive used by mining, blueprints, and factions.</p>
                </div>
              </div>

              <div className="game-data-settings">
                <div className="cloud-connection__header">
                  <div>
                    <span className="setting-label">Selected game archive</span>
                    <span className="setting-help" role="status" aria-live="polite">
                      {snapshot.dataStatus.message}
                    </span>
                  </div>
                  <GameDataStatus state={snapshot.dataStatus.state} />
                </div>

                <dl className="cloud-telemetry game-data-telemetry">
                  <div>
                    <dt>Data.p4k path</dt>
                    <dd title={snapshot.gameDataPath ?? undefined}>
                      {snapshot.gameDataPath ?? 'No local archive selected'}
                    </dd>
                  </div>
                </dl>

                <div className="cloud-actions game-data-actions">
                  <button
                    type="button"
                    disabled={gameDataInteractionBusy}
                    onClick={onChooseGameData}
                  >
                    <FolderOpen size={15} aria-hidden="true" />
                    {snapshot.gameDataPath ? 'Change archive' : 'Choose archive'}
                  </button>
                  <span>
                    Common LIVE and PTU installs are detected automatically. Choose a file only to
                    use another build.
                  </span>
                </div>
              </div>
            </section>

            <section
              className="settings-section"
              id="settings-cloud-sync"
              aria-labelledby="cloud-sync-title"
            >
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
                      {cloud.quarantinedOperationCount === 1 ? '' : 's'} were isolated so later
                      changes can continue.
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
                    <button
                      type="button"
                      disabled={interactionBusy}
                      onClick={onConfirmCloudProfileImport}
                    >
                      Review import
                    </button>
                  </div>
                )}

                <div className="cloud-actions">
                  {cloud.user ? (
                    <>
                      <button type="button" disabled={interactionBusy} onClick={onSyncCloud}>
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
                        disabled={interactionBusy}
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
                    <button type="button" disabled={interactionBusy} onClick={onBeginCloudLogin}>
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
                        Rockfall normally receives this automatically. Paste the one-time code only
                        if the browser could not reopen the app.
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

                {showAdminCloudSettings && (
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
                        disabled={interactionBusy}
                        onChange={(event) => setApiUrlDraft(event.target.value)}
                        placeholder="https://sc-overlay-api.antontishin.com"
                      />
                      <button
                        type="submit"
                        disabled={interactionBusy || !endpointChanged || !displayedApiUrl.trim()}
                      >
                        Apply
                      </button>
                    </div>
                    <span className="api-endpoint-form__note">
                      <ShieldCheck size={15} aria-hidden="true" />
                      Changing endpoints signs out the current cloud session. Self-signed
                      certificates are accepted only for loopback development URLs.
                    </span>
                  </form>
                )}
              </div>
            </section>

            {showAdminCloudSettings && (
              <section
                className="settings-section"
                id="settings-static-data"
                aria-labelledby="static-data-title"
              >
                <div className="settings-section__heading">
                  <Database size={18} aria-hidden="true" />
                  <div>
                    <h2 id="static-data-title">Static data</h2>
                    <p>
                      Publish one atomic mobile catalog from this PC&apos;s installed game build.
                    </p>
                  </div>
                </div>

                <div className="static-data-settings">
                  <div className="cloud-connection__header">
                    <div>
                      <span className="setting-label">Mobile catalog release</span>
                      <span className="setting-help" role="status" aria-live="polite">
                        {staticData.message}
                      </span>
                    </div>
                    <StaticDataStatus status={staticData.status} />
                  </div>

                  <dl className="cloud-telemetry">
                    <div>
                      <dt>Game build</dt>
                      <dd>{staticData.currentRelease?.gameBuild ?? 'Not published'}</dd>
                    </div>
                    <div>
                      <dt>Game version</dt>
                      <dd>{staticData.currentRelease?.gameVersion ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Channel</dt>
                      <dd>{staticData.currentRelease?.channel ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Published</dt>
                      <dd>{formatSyncTime(staticData.currentRelease?.publishedAt ?? null)}</dd>
                    </div>
                    <div>
                      <dt>Content</dt>
                      <dd>
                        {staticData.currentRelease
                          ? staticData.currentRelease.contentSetSha256.slice(0, 12)
                          : '—'}
                      </dd>
                    </div>
                  </dl>

                  {staticData.progress && (
                    <div className="static-data-progress" aria-label={staticData.progress.phase}>
                      <div>
                        <span>{staticData.progress.phase}</span>
                        <span>
                          {staticData.progress.completed} / {staticData.progress.total}
                        </span>
                      </div>
                      <progress
                        max={staticData.progress.total}
                        value={staticData.progress.completed}
                      />
                    </div>
                  )}

                  {staticData.status === 'error' && (
                    <div className="cloud-notice cloud-notice--danger" role="alert">
                      <TriangleAlert size={16} aria-hidden="true" />
                      <span>{staticData.message}</span>
                    </div>
                  )}

                  <div className="cloud-actions static-data-actions">
                    <button type="button" disabled={interactionBusy} onClick={onPublishStaticData}>
                      <RefreshCw
                        size={15}
                        aria-hidden="true"
                        className={
                          ['preparing', 'uploading', 'validating'].includes(staticData.status)
                            ? 'is-spinning'
                            : ''
                        }
                      />
                      {staticData.status === 'unavailable'
                        ? 'Check compatibility'
                        : 'Publish mobile catalog'}
                    </button>
                    <span>Requires a fresh extraction and replaces all resources together.</span>
                  </div>
                </div>
              </section>
            )}

            <section
              className="settings-section"
              id="settings-starstrings"
              aria-labelledby="starstrings-title"
            >
              <div className="settings-section__heading">
                <Languages size={18} aria-hidden="true" />
                <div>
                  <h2 id="starstrings-title">StarStrings</h2>
                  <p>Keep the community English strings in your LIVE game install up to date.</p>
                </div>
              </div>

              <div className="starstrings-settings">
                <div className="cloud-connection__header">
                  <div>
                    <span className="setting-label">Community localization</span>
                    <span className="setting-help" role="status" aria-live="polite">
                      {starStrings.message}
                    </span>
                  </div>
                  <StarStringsStatus status={starStrings.status} />
                </div>

                <dl className="cloud-telemetry starstrings-telemetry">
                  <div>
                    <dt>Target</dt>
                    <dd title={starStrings.gamePath ?? undefined}>
                      {starStrings.gamePath ?? 'LIVE not found'}
                    </dd>
                  </div>
                  <div>
                    <dt>Installed</dt>
                    <dd title={starStrings.installedRelease?.name}>
                      {starStrings.installedRelease?.name ?? 'Not managed'}
                    </dd>
                  </div>
                  <div>
                    <dt>Latest</dt>
                    <dd title={starStrings.availableRelease?.name}>
                      {starStrings.availableRelease?.name ?? 'Not checked'}
                    </dd>
                  </div>
                  <div>
                    <dt>Last install</dt>
                    <dd>{formatSyncTime(starStrings.installedRelease?.installedAt ?? null)}</dd>
                  </div>
                </dl>

                {starStringsBusy && (
                  <div className="static-data-progress starstrings-progress">
                    <div>
                      <span>
                        {starStrings.status === 'downloading'
                          ? 'Downloading release'
                          : starStrings.status === 'installing'
                            ? 'Installing files'
                            : 'Checking GitHub'}
                      </span>
                      <span>
                        {starStrings.progress === null ? 'In progress' : `${starStrings.progress}%`}
                      </span>
                    </div>
                    <progress max={100} value={starStrings.progress ?? undefined} />
                  </div>
                )}

                {starStrings.status === 'error' && (
                  <div className="cloud-notice cloud-notice--danger" role="alert">
                    <TriangleAlert size={16} aria-hidden="true" />
                    <span>{starStrings.message}</span>
                  </div>
                )}

                <div className="starstrings-source-note">
                  <ShieldCheck size={15} aria-hidden="true" />
                  <span>
                    Unofficial community package downloaded directly from MrKraken&apos;s GitHub
                    release.
                  </span>
                  <a
                    href="https://github.com/MrKraken/StarStrings"
                    target="_blank"
                    rel="noreferrer"
                  >
                    View project
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                </div>

                <div className="cloud-actions starstrings-actions">
                  <button
                    type="button"
                    disabled={starStrings.status === 'unavailable' || starStringsBusy}
                    onClick={onSyncStarStrings}
                  >
                    <RefreshCw
                      size={15}
                      aria-hidden="true"
                      className={starStringsBusy ? 'is-spinning' : ''}
                    />
                    {starStrings.status === 'current' ? 'Check again' : 'Sync latest release'}
                  </button>
                  <span>
                    Preserves existing <code>USER.cfg</code> entries and enables English
                    localization.
                  </span>
                </div>
              </div>
            </section>

            <section
              className="settings-section"
              id="settings-appearance"
              aria-labelledby="appearance-title"
            >
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

            <OverlaySettings
              snapshot={snapshot}
              onUpdateSettings={onUpdateSettings}
              onExecuteOverlayCommand={onExecuteOverlayCommand}
              onSetShortcutCapture={onSetShortcutCapture}
            />

            <LanControlSettings
              config={lanConfig}
              state={lanState}
              onConfigure={onConfigureLanControl}
              onBeginPairing={onBeginLanPairing}
              onCancelPairing={onCancelLanPairing}
              onRevokeClient={onRevokeLanClient}
              onResetIdentity={onResetLanIdentity}
            />
          </div>
        </div>
      </div>
    </main>
  )
}

function StarStringsStatus({
  status
}: {
  status: StarStringsSyncState['status']
}): React.JSX.Element {
  const label =
    status === 'unavailable'
      ? 'LIVE not found'
      : status === 'ready'
        ? 'Ready'
        : status === 'checking'
          ? 'Checking'
          : status === 'downloading'
            ? 'Downloading'
            : status === 'installing'
              ? 'Installing'
              : status === 'current'
                ? 'Current'
                : status === 'installed'
                  ? 'Installed'
                  : 'Sync error'
  return (
    <span className={`cloud-status starstrings-status--${status}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  )
}

function StaticDataStatus({
  status
}: {
  status: StaticDataSyncState['status']
}): React.JSX.Element {
  const label =
    status === 'already-current'
      ? 'Current'
      : status === 'published'
        ? 'Published'
        : status === 'ready'
          ? 'Ready'
          : status === 'error'
            ? 'Publish error'
            : status === 'unavailable'
              ? 'Unavailable'
              : status === 'checking'
                ? 'Checking'
                : status === 'confirming'
                  ? 'Confirming'
                  : status === 'preparing'
                    ? 'Preparing'
                    : status === 'uploading'
                      ? 'Uploading'
                      : 'Validating'
  return (
    <span className={`cloud-status static-data-status--${status}`}>
      <span aria-hidden="true" />
      {label}
    </span>
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

function GameDataStatus({
  state
}: {
  state: AppSnapshot['dataStatus']['state']
}): React.JSX.Element {
  const label = {
    loading: 'Syncing',
    game: 'Local archive',
    live: 'Wiki fallback',
    cached: 'Cached',
    fallback: 'Bundled fallback'
  }[state]

  return (
    <span className={`cloud-status game-data-status game-data-status--${state}`}>
      <span />
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
