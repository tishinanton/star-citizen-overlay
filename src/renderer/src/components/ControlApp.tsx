import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  BookOpen,
  Crosshair,
  Database,
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

export default function ControlApp(): React.JSX.Element {
  const {
    snapshot,
    error,
    updateSettings,
    executeOverlayCommand,
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
    publishStaticData,
    syncStarStrings,
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
        className="mining-workspace"
        id="panel-mining"
        role="tabpanel"
        aria-labelledby="tab-mining"
        hidden={activeTab !== 'mining'}
      >
        <MiningWorkspace
          snapshot={snapshot}
          onUpdateSettings={updateSettings}
          onExecuteOverlayCommand={executeOverlayCommand}
          onRefreshMaterials={refreshMaterials}
          onChooseGameData={chooseGameData}
          onGetMiningLocations={getMiningLocations}
        />
      </main>
      {activeTab === 'blueprints' && <BlueprintBrowser />}
      {activeTab === 'factions' && <FactionBrowser />}
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
          onConfigureLanControl={configureLanControl}
          onBeginLanPairing={beginLanPairing}
          onCancelLanPairing={cancelLanPairing}
          onRevokeLanClient={revokeLanClient}
          onResetLanIdentity={resetLanIdentity}
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
                : 'Overlay and interface changes are saved automatically.'}
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
