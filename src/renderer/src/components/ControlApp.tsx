import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  BookOpen,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Pickaxe,
  RefreshCw,
  Settings as SettingsIcon,
  Shield,
  Zap
} from 'lucide-react'

import { type AppUpdateState, type DataSourceState } from '../../../shared/contracts'
import { useRockfall } from '../hooks/useRockfall'
import { formatAccelerator } from '../lib/shortcut-accelerator'
import BlueprintBrowser from './BlueprintBrowser'
import FactionBrowser from './FactionBrowser'
import MiningWorkspace from './MiningWorkspace'
import SettingsPage from './SettingsPage'

type AppTab = 'mining' | 'blueprints' | 'factions' | 'settings'

const APP_TABS: AppTab[] = ['mining', 'blueprints', 'factions', 'settings']
const TAB_DETAILS: Record<AppTab, { label: string; description: string }> = {
  mining: {
    label: 'Mining operations',
    description: 'Compare ore signatures, locations, and rock composition.'
  },
  blueprints: {
    label: 'Blueprint archive',
    description: 'Trace crafting requirements, access, and ownership.'
  },
  factions: {
    label: 'Faction directory',
    description: 'Inspect standings, thresholds, perks, and reputation gates.'
  },
  settings: {
    label: 'System settings',
    description: 'Configure the overlay, data sources, shortcuts, cloud, and LAN control.'
  }
}

export default function ControlApp(): React.JSX.Element {
  const {
    snapshot,
    error,
    gameDataSyncing,
    gameDataRevision,
    updateSettings,
    executeOverlayCommand,
    syncGameData,
    chooseGameData,
    getMiningLocations,
    setShortcutCapture,
    beginCloudLogin,
    completeCloudLogin,
    cancelCloudLogin,
    syncCloud,
    confirmCloudProfileImport,
    logoutCloud,
    publishStaticData,
    syncStarStrings,
    setLocalizationSource,
    checkForUpdates,
    restartToUpdate,
    configureLanControl,
    beginLanPairing,
    cancelLanPairing,
    revokeLanClient,
    resetLanIdentity
  } = useRockfall()
  const [activeTab, setActiveTab] = useState<AppTab>('mining')

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

  const { settings, dataStatus, appUpdate } = snapshot
  const activeWorkspace = TAB_DETAILS[activeTab]

  const activateTab = (tab: AppTab): void => {
    if (tab !== activeTab) setActiveTab(tab)
  }

  const handleTabKeyDown = (tab: AppTab, event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const currentIndex = APP_TABS.indexOf(tab)
    const nextTab =
      event.key === 'Home'
        ? APP_TABS[0]
        : event.key === 'End'
          ? APP_TABS[APP_TABS.length - 1]
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? APP_TABS[(currentIndex - 1 + APP_TABS.length) % APP_TABS.length]
            : event.key === 'ArrowRight' || event.key === 'ArrowDown'
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
        <div className="app-header__command">
          <div className="app-header__context">
            <h1>{activeWorkspace.label}</h1>
            <p>{activeWorkspace.description}</p>
          </div>

          <div className="app-header__actions">
            <GameDataSyncControl
              syncing={gameDataSyncing}
              sourceLoading={dataStatus.state === 'loading'}
              onSync={() => void syncGameData()}
            />
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
        </div>
      </header>

      {(error || snapshot.warning) && (
        <div className="system-warning" role="alert">
          <Zap size={15} />
          {error ?? snapshot.warning}
        </div>
      )}

      <main
        className="mining-workspace"
        id="panel-mining"
        role="tabpanel"
        aria-labelledby="tab-mining"
        hidden={activeTab !== 'mining'}
      >
        <MiningWorkspace
          snapshot={snapshot}
          gameDataRevision={gameDataRevision}
          onUpdateSettings={updateSettings}
          onExecuteOverlayCommand={executeOverlayCommand}
          onGetMiningLocations={getMiningLocations}
        />
      </main>
      {activeTab === 'blueprints' && <BlueprintBrowser gameDataRevision={gameDataRevision} />}
      {activeTab === 'factions' && <FactionBrowser gameDataRevision={gameDataRevision} />}
      {activeTab === 'settings' && (
        <SettingsPage
          snapshot={snapshot}
          fontSize={settings.appFontSize}
          apiUrl={settings.cloudApiUrl}
          lanConfig={settings.lanControl}
          lanState={snapshot.lanControl}
          cloud={snapshot.cloud}
          staticData={snapshot.staticData}
          starStrings={snapshot.starStrings}
          gameDataSyncing={gameDataSyncing}
          onFontSizeChange={(appFontSize) => void updateSettings({ appFontSize })}
          onApiUrlChange={(cloudApiUrl) => void updateSettings({ cloudApiUrl })}
          onUpdateSettings={updateSettings}
          onExecuteOverlayCommand={executeOverlayCommand}
          onSetShortcutCapture={setShortcutCapture}
          onBeginCloudLogin={() => void beginCloudLogin()}
          onCompleteCloudLogin={(handoffCode) => void completeCloudLogin(handoffCode)}
          onCancelCloudLogin={() => void cancelCloudLogin()}
          onSyncCloud={() => void syncCloud()}
          onConfirmCloudProfileImport={() => void confirmCloudProfileImport()}
          onLogoutCloud={() => void logoutCloud()}
          onPublishStaticData={() => void publishStaticData()}
          onSyncStarStrings={() => void syncStarStrings()}
          onSetLocalizationSource={(source) => void setLocalizationSource(source)}
          onChooseGameData={() => void chooseGameData()}
          onConfigureLanControl={configureLanControl}
          onBeginLanPairing={beginLanPairing}
          onCancelLanPairing={cancelLanPairing}
          onRevokeLanClient={revokeLanClient}
          onResetLanIdentity={resetLanIdentity}
        />
      )}

      <footer className="app-footer">
        <DataStatus state={dataStatus.state} message={dataStatus.message} />

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
            <Pickaxe size={17} />
            <span>Mining</span>
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
            <BookOpen size={17} />
            <span>Blueprints</span>
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
            <Shield size={17} />
            <span>Factions</span>
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
            <SettingsIcon size={17} />
            <span>Settings</span>
          </button>
        </nav>

        {activeTab === 'mining' ? (
          <a href="https://api.star-citizen.wiki/" target="_blank" rel="noreferrer">
            Wiki metadata
          </a>
        ) : null}
      </footer>
    </div>
  )
}

function GameDataSyncControl({
  syncing,
  sourceLoading,
  onSync
}: {
  syncing: boolean
  sourceLoading: boolean
  onSync: () => void
}): React.JSX.Element {
  const busy = syncing || sourceLoading
  const label = busy ? 'Syncing game data…' : 'Sync game data'

  return (
    <button
      className={`icon-text-button game-data-sync-control ${
        busy ? 'game-data-sync-control--syncing' : ''
      }`}
      type="button"
      disabled={busy}
      aria-busy={busy}
      title="Refresh mining, blueprint, and faction data from the selected game archive."
      onClick={onSync}
    >
      <RefreshCw size={14} className={busy ? 'is-spinning' : ''} />
      {label}
    </button>
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
