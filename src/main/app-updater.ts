import type { AppUpdateState } from '../shared/contracts'
import type { AppUpdater } from 'electron-updater'

const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000

interface UpdaterVersionInfo {
  version: string
}

interface UpdaterProgressInfo {
  percent: number
}

export interface UpdaterClient {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates: () => Promise<unknown>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
  onError: (listener: (error: Error) => void) => void
  onCheckingForUpdate: (listener: () => void) => void
  onUpdateAvailable: (listener: (info: UpdaterVersionInfo) => void) => void
  onUpdateNotAvailable: (listener: (info: UpdaterVersionInfo) => void) => void
  onDownloadProgress: (listener: (progress: UpdaterProgressInfo) => void) => void
  onUpdateDownloaded: (listener: (info: UpdaterVersionInfo) => void) => void
}

export function createUpdaterClient(updater: AppUpdater): UpdaterClient {
  return {
    get autoDownload() {
      return updater.autoDownload
    },
    set autoDownload(value) {
      updater.autoDownload = value
    },
    get autoInstallOnAppQuit() {
      return updater.autoInstallOnAppQuit
    },
    set autoInstallOnAppQuit(value) {
      updater.autoInstallOnAppQuit = value
    },
    checkForUpdates: () => updater.checkForUpdates(),
    quitAndInstall: (isSilent, isForceRunAfter) =>
      updater.quitAndInstall(isSilent, isForceRunAfter),
    onError: (listener) => {
      updater.on('error', listener)
    },
    onCheckingForUpdate: (listener) => {
      updater.on('checking-for-update', listener)
    },
    onUpdateAvailable: (listener) => {
      updater.on('update-available', listener)
    },
    onUpdateNotAvailable: (listener) => {
      updater.on('update-not-available', listener)
    },
    onDownloadProgress: (listener) => {
      updater.on('download-progress', listener)
    },
    onUpdateDownloaded: (listener) => {
      updater.on('update-downloaded', listener)
    }
  }
}

interface AppUpdaterControllerOptions {
  enabled: boolean
  currentVersion: string
  onStateChange: (state: AppUpdateState) => void
  checkIntervalMs?: number
}

export class AppUpdaterController {
  private readonly enabled: boolean
  private readonly currentVersion: string
  private readonly onStateChange: (state: AppUpdateState) => void
  private readonly checkIntervalMs: number
  private state: AppUpdateState
  private started = false
  private checkInFlight: Promise<AppUpdateState> | null = null
  private checkTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly updater: UpdaterClient,
    options: AppUpdaterControllerOptions
  ) {
    this.enabled = options.enabled
    this.currentVersion = options.currentVersion
    this.onStateChange = options.onStateChange
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS
    this.state = {
      status: this.enabled ? 'idle' : 'unavailable',
      currentVersion: this.currentVersion,
      availableVersion: null,
      downloadProgress: null,
      message: this.enabled
        ? 'Updates are checked automatically.'
        : 'Update checks are available in installed builds.'
    }
  }

  getState(): AppUpdateState {
    return { ...this.state }
  }

  start(): void {
    if (this.started) return
    this.started = true
    if (!this.enabled) return

    this.updater.autoDownload = true
    this.updater.autoInstallOnAppQuit = true
    this.bindUpdaterEvents()

    this.checkTimer = setInterval(() => {
      void this.checkForUpdates()
    }, this.checkIntervalMs)
    this.checkTimer.unref()
    void this.checkForUpdates()
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  checkForUpdates(): Promise<AppUpdateState> {
    if (!this.enabled || this.state.status === 'downloading' || this.state.status === 'ready') {
      return Promise.resolve(this.getState())
    }
    if (this.checkInFlight) return this.checkInFlight

    this.setState({
      status: 'checking',
      availableVersion: null,
      downloadProgress: null,
      message: 'Checking for updates…'
    })
    this.checkInFlight = this.runUpdateCheck()
    return this.checkInFlight
  }

  restartToUpdate(): void {
    if (this.state.status !== 'ready') {
      throw new Error('No downloaded update is ready to install.')
    }
    this.updater.quitAndInstall(false, true)
  }

  private bindUpdaterEvents(): void {
    this.updater.onCheckingForUpdate(() => {
      this.setState({
        status: 'checking',
        availableVersion: null,
        downloadProgress: null,
        message: 'Checking for updates…'
      })
    })
    this.updater.onUpdateAvailable(({ version }) => {
      this.setState({
        status: 'downloading',
        availableVersion: version,
        downloadProgress: 0,
        message: `Downloading Rockfall v${version}…`
      })
    })
    this.updater.onDownloadProgress(({ percent }) => {
      const normalizedPercent = Number.isFinite(percent) ? percent : 0
      const downloadProgress = Math.min(100, Math.max(0, Math.round(normalizedPercent)))
      this.setState({
        status: 'downloading',
        availableVersion: this.state.availableVersion,
        downloadProgress,
        message: `Downloading update… ${downloadProgress}%`
      })
    })
    this.updater.onUpdateDownloaded(({ version }) => {
      this.setState({
        status: 'ready',
        availableVersion: version,
        downloadProgress: 100,
        message: `Rockfall v${version} is ready to install.`
      })
    })
    this.updater.onUpdateNotAvailable(() => {
      this.setState({
        status: 'up-to-date',
        availableVersion: null,
        downloadProgress: null,
        message: 'Rockfall is up to date.'
      })
    })
    this.updater.onError((error) => {
      this.setErrorState(error)
    })
  }

  private async runUpdateCheck(): Promise<AppUpdateState> {
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.setErrorState(error)
    } finally {
      this.checkInFlight = null
    }
    return this.getState()
  }

  private setErrorState(error: unknown): void {
    const detail = error instanceof Error && error.message ? error.message : 'Unknown update error.'
    this.setState({
      status: 'error',
      availableVersion: null,
      downloadProgress: null,
      message: `Update failed: ${detail}`
    })
  }

  private setState(state: Omit<AppUpdateState, 'currentVersion'>): void {
    this.state = {
      currentVersion: this.currentVersion,
      ...state
    }
    this.onStateChange(this.getState())
  }
}
