import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  screen,
  shell,
  Tray,
  type IpcMainInvokeEvent
} from 'electron'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { stat } from 'node:fs/promises'

import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'

import {
  IPC_CHANNELS,
  type AppSnapshot,
  type AppUpdateState,
  type BestMiningLocationState,
  type BlueprintCatalogResult,
  type BlueprintDetailResult,
  type BlueprintOwnershipSnapshot,
  type BlueprintThumbnailResult,
  type CloudSyncState,
  type FactionCatalogResult,
  type GameDataSelectionResult,
  type MiningDataStatus,
  type MiningLocationResult,
  type MiningMaterial,
  type LocalizationSource,
  type OverlayContentMetrics,
  type OverlayPosition,
  type OverlayPlacement,
  type OverlaySettings,
  type OverlaySettingsPatch,
  type ShortcutStatus,
  type StarStringsSyncState,
  type StaticDataReleaseSummary,
  type StaticDataSyncState
} from '../shared/contracts'
import {
  MAX_LAN_CONTROL_PORT,
  MIN_LAN_CONTROL_PORT,
  type LanCommandRequestV1,
  type LanControlConfig,
  type LanControlState,
  type LanOverlayCommandV1,
  type LanPairingSession,
  parseLanOverlayCommand
} from '../shared/lan-control'
import {
  getOverlayDisplayLayout,
  getOverlayFallbackLayout,
  getOverlayLayoutKey,
  type OverlayLayout
} from '../shared/overlay-layout'
import { AppUpdaterController, createUpdaterClient } from './app-updater'
import { prepareBlueprintDataLoad, type BlueprintDataResult } from './blueprint-data'
import { BlueprintOwnershipService } from './blueprint-ownership'
import { BlueprintThumbnailService } from './blueprint-thumbnail'
import { CloudSyncController } from './cloud-sync'
import { loadFactionData } from './faction-data'
import {
  loadGameDataPreference,
  resolveGameDataArchive,
  saveGameDataPreference,
  validateGameDataArchive,
  type GameDataArchive
} from './game-data'
import type { MiningCatalog } from './mining-catalog'
import { loadMiningData } from './mining-data'
import { loadMiningLocations, resolvePreferredMiningLocation } from './mining-locations'
import {
  loadLocalizationSource,
  saveLocalizationSource,
  validateLocalizationSource
} from './localization-source'
import {
  LanControlServer,
  type LanCommandExecutionContext,
  type LanDomainState
} from './lan-control-server'
import { LanControlStore } from './lan-control-store'
import { resolveOverlayCommand } from './overlay-commands'
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, saveSettings } from './settings-store'
import {
  downloadAndInstallStarStrings,
  fetchLatestStarStringsRelease,
  inspectStarStringsInstallation,
  resolveLiveGamePath
} from './starstrings'
import {
  prepareStaticData,
  type PreparedStaticData,
  type StaticDataPreparationProgress
} from './static-data'

const SCREEN_MARGIN = 24
const ROCKFALL_PROTOCOL = 'rockfall'
const LAN_SHUTDOWN_TIMEOUT_MS = 3_000

if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient(ROCKFALL_PROTOCOL, process.execPath, [resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient(ROCKFALL_PROTOCOL)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

const SHORTCUT_DEFINITIONS: Array<
  Omit<ShortcutStatus, 'accelerator' | 'registered'> & { action: () => void }
> = [
  {
    id: 'toggle-overlay',
    label: 'Show / hide overlay',
    action: () =>
      runInBackground(
        'Overlay visibility could not be changed',
        updateSettings({ visible: !settings.visible })
      )
  },
  {
    id: 'next-target',
    label: 'Spotlight next target',
    action: () =>
      runInBackground(
        'The next target could not be selected',
        executeOverlayCommand({ operation: 'overlay.target.cycle' }).then(() => undefined)
      )
  },
  {
    id: 'show-all',
    label: 'Show all selected targets',
    action: () =>
      runInBackground(
        'The target spotlight could not be cleared',
        updateSettings({ spotlightMaterialId: null })
      )
  },
  {
    id: 'toggle-compact',
    label: 'Toggle compact layout',
    action: () =>
      runInBackground(
        'Compact mode could not be changed',
        executeOverlayCommand({
          operation: 'overlay.compact.set',
          enabled: !settings.compact
        }).then(() => undefined)
      )
  }
]

let controlWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let dragHandleWindow: BrowserWindow | null = null
let overlayCollapsed = false
let tray: Tray | null = null
let settings: OverlaySettings = {
  ...DEFAULT_SETTINGS,
  selectedMaterialIds: [...DEFAULT_SETTINGS.selectedMaterialIds],
  signatureOverrides: { ...DEFAULT_SETTINGS.signatureOverrides },
  favoriteMiningLocationIds: { ...DEFAULT_SETTINGS.favoriteMiningLocationIds },
  shortcuts: { ...DEFAULT_SETTINGS.shortcuts },
  lanControl: { ...DEFAULT_SETTINGS.lanControl }
}
let materials: MiningMaterial[] = []
let bestMiningLocations: Record<string, BestMiningLocationState> = {}
let dataStatus: MiningDataStatus = {
  state: 'loading',
  message: 'Loading mining signatures…',
  updatedAt: null
}
let appUpdate: AppUpdateState = {
  status: 'unavailable',
  currentVersion: app.getVersion(),
  availableVersion: null,
  downloadProgress: null,
  message: 'Update checks are available in installed builds.'
}
let cloudSync: CloudSyncState = {
  status: 'signed-out',
  user: null,
  message: 'Sign in with Discord to synchronize blueprint ownership.',
  lastSyncedAt: null,
  pendingOperationCount: 0,
  quarantinedOperationCount: 0,
  blockedProfileCount: 0,
  loginExpiresAt: null,
  refreshTokenPersistent: false
}
let staticData: StaticDataSyncState = {
  status: 'unavailable',
  canPublish: false,
  message: 'Sign in as an administrator to publish static data.',
  progress: null,
  currentRelease: null
}
let staticDataPublication: Promise<StaticDataSyncState> | null = null
let starStrings: StarStringsSyncState = {
  status: 'unavailable',
  gamePath: null,
  message: 'No Star Citizen LIVE installation was detected.',
  progress: null,
  installedRelease: null,
  availableRelease: null,
  localizationSource: 'game'
}
let lanControlState: LanControlState = {
  status: 'disabled',
  enabled: false,
  port: DEFAULT_SETTINGS.lanControl.port,
  endpoints: [],
  serverId: null,
  tlsSpkiSha256: null,
  verificationCode: null,
  pairingExpiresAt: null,
  pairedClients: [],
  message: 'LAN control is disabled.'
}
let starStringsOperation: Promise<StarStringsSyncState> | null = null
let gameDataSelectionActive = false
let shortcutStatuses: ShortcutStatus[] = []
let warning: string | null = null
let settingsPath = ''
let cachePath = ''
let miningCatalogCachePath = ''
let locationCachePath = ''
let blueprintCatalogCachePath = ''
let blueprintThumbnailCachePath = ''
let blueprintThumbnailTemporaryPath = ''
let factionCatalogCachePath = ''
let blueprintOwnershipPath = ''
let cloudStatePath = ''
let gameDataPreferencePath = ''
let starStringsRecordPath = ''
let localizationSourcePath = ''
let lanControlPath = ''
let gameDataArchive: GameDataArchive | null = null
let localizationSource: LocalizationSource = 'game'
let extractorPath = ''
let miningCatalog: MiningCatalog | null = null
let miningCatalogMaterialIdByMaterialId: ReadonlyMap<string, string> = new Map()
let appUpdater: AppUpdaterController | null = null
let isQuitting = false
let lanShutdownComplete = false
let lanShutdownInProgress = false
let appInitialized = false
let focusRequestedDuringStartup = false
let shortcutCaptureActive = false
let expectedOverlayPosition: OverlayPosition | null = null
let overlayPositionTimer: NodeJS.Timeout | null = null
let measuredOverlayMetrics: OverlayContentMetrics | null = null
let miningLocationGeneration = 0
const miningLocationResults = new Map<string, MiningLocationResult>()
const pendingLocationRequests = new Map<string, Promise<MiningLocationResult>>()
let blueprintDataResult: BlueprintDataResult | null = null
let blueprintDataGeneration = 0
let pendingBlueprintData: {
  generation: number
  visible: Promise<BlueprintDataResult>
  request: Promise<BlueprintDataResult>
} | null = null
let factionDataResult: FactionCatalogResult | null = null
let factionDataGeneration = 0
let pendingFactionData: {
  generation: number
  request: Promise<FactionCatalogResult>
} | null = null
let blueprintOwnershipService: BlueprintOwnershipService | null = null
let blueprintThumbnailService: BlueprintThumbnailService | null = null
let cloudSyncController: CloudSyncController | null = null
let lanControlServer: LanControlServer | null = null
let suppressCloudOwnershipCapture = false
let settingsMutationQueue: Promise<void> = Promise.resolve()
const pendingProtocolUrls = process.argv.filter((argument) => argument.startsWith('rockfall://'))

function getSnapshot(): AppSnapshot {
  return {
    materials,
    bestMiningLocations,
    settings,
    dataStatus,
    gameDataPath: gameDataArchive?.path ?? null,
    shortcuts: shortcutStatuses,
    appUpdate,
    cloud: cloudSync,
    staticData,
    starStrings,
    lanControl: lanControlState,
    warning
  }
}

function broadcastSnapshot(
  targetWindows: ReadonlyArray<BrowserWindow | null> = [
    controlWindow,
    overlayWindow,
    dragHandleWindow
  ]
): void {
  const snapshot = getSnapshot()
  for (const window of targetWindows) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.snapshotChanged, snapshot)
    }
  }
}

function broadcastOverlayWindowState(): void {
  for (const window of [overlayWindow, dragHandleWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.overlayWindowStateChanged, {
        collapsed: overlayCollapsed
      })
    }
  }
}

function broadcastBlueprintOwnership(): void {
  if (!blueprintDataResult || !blueprintOwnershipService) return
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send(
      IPC_CHANNELS.blueprintOwnershipChanged,
      blueprintOwnershipService.getSnapshot(
        blueprintDataResult.catalog.blueprints,
        cloudSyncController?.getOwnershipLayer() ?? null
      )
    )
  }
}

function broadcastBlueprintCatalog(): void {
  if (!blueprintDataResult || !controlWindow || controlWindow.isDestroyed()) return
  controlWindow.webContents.send(IPC_CHANNELS.blueprintCatalogChanged, blueprintDataResult.catalog)
}

function handleBlueprintOwnershipChange(): void {
  broadcastBlueprintOwnership()
  if (!suppressCloudOwnershipCapture && cloudSyncController) {
    runInBackground(
      'Cloud ownership changes could not be queued',
      cloudSyncController.captureLocalChanges()
    )
  }
}

function runInBackground(context: string, operation: Promise<unknown>): void {
  void operation.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    warning = `${context}: ${message}`
    console.error(warning)
    broadcastSnapshot()
  })
}

function getOverlayLayout(): OverlayLayout {
  const fallback = getOverlayFallbackLayout(settings)
  if (measuredOverlayMetrics?.layoutKey !== getOverlayLayoutKey(settings)) return fallback

  return {
    ...fallback,
    height: measuredOverlayMetrics.height,
    headerHeight: measuredOverlayMetrics.headerHeight
  }
}

function getOverlayPosition(
  placement: OverlayPlacement,
  size: Pick<OverlayLayout, 'width' | 'height'>
): { x: number; y: number } {
  if (settings.customPosition) {
    const display = screen.getDisplayNearestPoint(settings.customPosition)
    const { x, y, width, height } = display.workArea
    return {
      x: Math.min(Math.max(settings.customPosition.x, x), x + width - size.width),
      y: Math.min(Math.max(settings.customPosition.y, y), y + height - size.height)
    }
  }

  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  const left = x + SCREEN_MARGIN
  const right = x + width - size.width - SCREEN_MARGIN
  const top = y + SCREEN_MARGIN
  const bottom = y + height - size.height - SCREEN_MARGIN

  switch (placement) {
    case 'top-left':
      return { x: left, y: top }
    case 'bottom-left':
      return { x: left, y: bottom }
    case 'bottom-right':
      return { x: right, y: bottom }
    case 'top-right':
      return { x: right, y: top }
  }
}

function applyOverlayState(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return

  const { width, height, headerHeight } = getOverlayDisplayLayout(
    getOverlayLayout(),
    overlayCollapsed
  )
  const size = { width, height }
  const position = getOverlayPosition(settings.placement, size)
  expectedOverlayPosition = position
  overlayWindow.setSize(size.width, size.height, false)
  overlayWindow.setPosition(position.x, position.y, true)
  if (dragHandleWindow && !dragHandleWindow.isDestroyed()) {
    dragHandleWindow.setSize(size.width, headerHeight, false)
    dragHandleWindow.setShape([{ x: 0, y: 0, width: size.width, height: headerHeight }])
    dragHandleWindow.setPosition(position.x, position.y, true)
  }
  setTimeout(() => {
    if (expectedOverlayPosition?.x === position.x && expectedOverlayPosition.y === position.y) {
      expectedOverlayPosition = null
    }
  }, 250)

  if (settings.visible) {
    overlayWindow.showInactive()
    overlayWindow.moveTop()
    dragHandleWindow?.showInactive()
    dragHandleWindow?.moveTop()
  } else {
    overlayWindow.hide()
    dragHandleWindow?.hide()
  }
}

function persistOverlayPosition(): void {
  if (!dragHandleWindow || dragHandleWindow.isDestroyed()) return

  const [x, y] = dragHandleWindow.getPosition()
  if (expectedOverlayPosition?.x === x && expectedOverlayPosition.y === y) return

  if (overlayPositionTimer) clearTimeout(overlayPositionTimer)
  overlayPositionTimer = setTimeout(() => {
    runInBackground('Overlay position could not be saved', saveDraggedOverlayPosition({ x, y }))
  }, 150)
}

function syncOverlayToDragHandle(): void {
  if (
    !dragHandleWindow ||
    dragHandleWindow.isDestroyed() ||
    !overlayWindow ||
    overlayWindow.isDestroyed()
  ) {
    return
  }

  const [x, y] = dragHandleWindow.getPosition()
  overlayWindow.setPosition(x, y, false)
}

function normalizeOverlayMetrics(value: unknown): OverlayContentMetrics {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Overlay content metrics must be an object.')
  }

  const { layoutKey, height, headerHeight } = value as Record<string, unknown>
  if (typeof layoutKey !== 'string' || layoutKey.length === 0 || layoutKey.length > 1_000) {
    throw new TypeError('Overlay content metrics require a valid layout key.')
  }
  if (
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    typeof headerHeight !== 'number' ||
    !Number.isFinite(headerHeight)
  ) {
    throw new TypeError('Overlay content dimensions must be finite numbers.')
  }

  const normalizedHeight = Math.ceil(height)
  const normalizedHeaderHeight = Math.ceil(headerHeight)
  if (
    normalizedHeaderHeight < 24 ||
    normalizedHeaderHeight > 512 ||
    normalizedHeight < normalizedHeaderHeight ||
    normalizedHeight > 4_096
  ) {
    throw new RangeError('Overlay content dimensions are outside the supported range.')
  }

  return {
    layoutKey,
    height: normalizedHeight,
    headerHeight: normalizedHeaderHeight
  }
}

function applyMeasuredOverlayMetrics(value: unknown): void {
  const metrics = normalizeOverlayMetrics(value)
  if (metrics.layoutKey !== getOverlayLayoutKey(settings)) return
  if (
    measuredOverlayMetrics?.layoutKey === metrics.layoutKey &&
    measuredOverlayMetrics.height === metrics.height &&
    measuredOverlayMetrics.headerHeight === metrics.headerHeight
  ) {
    return
  }

  measuredOverlayMetrics = metrics
  applyOverlayState()
}

async function saveDraggedOverlayPosition(position: OverlayPosition): Promise<void> {
  await enqueueSettingsMutation(async () => {
    await applySettingsPatch({ customPosition: position })
  })
}

function enqueueSettingsMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = settingsMutationQueue.then(operation, operation)
  settingsMutationQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function updateSettings(patch: OverlaySettingsPatch): Promise<AppSnapshot> {
  return enqueueSettingsMutation(() => applySettingsPatch(patch))
}

async function applySettingsPatch(patch: OverlaySettingsPatch): Promise<AppSnapshot> {
  const shortcutsChanged = patch.shortcuts !== undefined
  const favoriteMiningLocationsChanged = patch.favoriteMiningLocationIds !== undefined
  const next = mergeSettings(settings, patch)
  const miningQualityThresholdChanged =
    next.miningQualityThreshold !== settings.miningQualityThreshold
  const cloudApiChanged = next.cloudApiUrl !== settings.cloudApiUrl
  if (getOverlayLayoutKey(next) !== getOverlayLayoutKey(settings)) {
    measuredOverlayMetrics = null
  }
  await saveSettings(settingsPath, next)
  settings = next
  if (miningQualityThresholdChanged) {
    miningLocationGeneration += 1
    miningLocationResults.clear()
    pendingLocationRequests.clear()
    bestMiningLocations = {}
  }
  if (favoriteMiningLocationsChanged) refreshPreferredMiningLocationStates()
  warning = null
  if (cloudApiChanged && cloudSyncController) {
    cloudSync = await cloudSyncController.changeApiUrl(next.cloudApiUrl)
  }
  if (shortcutsChanged && !shortcutCaptureActive) {
    shortcutStatuses = registerShortcuts()
  }
  applyOverlayState()
  broadcastSnapshot()
  synchronizeLanState()
  queueSelectedMiningLocations()
  return getSnapshot()
}

function executeOverlayCommand(command: LanOverlayCommandV1): Promise<AppSnapshot> {
  return enqueueSettingsMutation(async () => {
    const result = resolveOverlayCommand(
      command,
      settings,
      materials,
      dataStatus.state === 'loading'
    )
    if (result.patch) await applySettingsPatch(result.patch)
    return getSnapshot()
  })
}

function executeLanCommand(
  command: LanCommandRequestV1,
  context: LanCommandExecutionContext
): Promise<'applied' | 'noop'> {
  return enqueueSettingsMutation(async () => {
    context.assertExpected()
    const result = resolveOverlayCommand(
      command,
      settings,
      materials,
      dataStatus.state === 'loading'
    )
    if (result.patch) {
      await applySettingsPatch(result.patch)
    } else {
      synchronizeLanState()
    }
    return result.result
  })
}

function getLanDomainState(): LanDomainState {
  return {
    catalog: {
      state: dataStatus.state,
      message: dataStatus.message,
      updatedAt: dataStatus.updatedAt,
      items: materials.map(({ id, commodityId, name, displayName, methods }) => ({
        id,
        commodityId,
        name,
        displayName,
        methods: [...methods]
      }))
    },
    overlay: {
      selectedItemIds: [...settings.selectedMaterialIds],
      compact: settings.compact,
      spotlightItemId: settings.spotlightMaterialId
    }
  }
}

function synchronizeLanState(force = false): void {
  const server = lanControlServer
  if (!server || !lanControlState.serverId) return
  server.synchronizeState(force)
}

function normalizeLanControlConfig(value: unknown): LanControlConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('LAN control configuration must be an object.')
  }
  const { enabled, port } = value as Record<string, unknown>
  if (typeof enabled !== 'boolean') {
    throw new TypeError('LAN control enabled state must be a boolean.')
  }
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < MIN_LAN_CONTROL_PORT ||
    port > MAX_LAN_CONTROL_PORT
  ) {
    throw new RangeError(
      `LAN control port must be between ${MIN_LAN_CONTROL_PORT} and ${MAX_LAN_CONTROL_PORT}.`
    )
  }
  return { enabled, port }
}

function configureLanControl(value: unknown): Promise<AppSnapshot> {
  const config = normalizeLanControlConfig(value)
  return enqueueSettingsMutation(async () => {
    const server = lanControlServer
    if (!server) throw new Error('LAN control is not initialized.')
    await applySettingsPatch({ lanControl: config })
    if (config.enabled) {
      if (
        lanControlState.status === 'disabled' ||
        lanControlState.status === 'error' ||
        lanControlState.port !== config.port
      ) {
        await server.start(config.port)
      }
    } else {
      await server.stop()
    }
    return getSnapshot()
  })
}

function beginLanPairing(): LanPairingSession {
  const server = lanControlServer
  if (!server) throw new Error('LAN control is not initialized.')
  return server.beginPairing()
}

function cancelLanPairing(): AppSnapshot {
  const server = lanControlServer
  if (!server) throw new Error('LAN control is not initialized.')
  server.cancelPairing()
  return getSnapshot()
}

async function revokeLanClient(clientId: unknown): Promise<AppSnapshot> {
  if (
    typeof clientId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)
  ) {
    throw new TypeError('A valid paired device is required.')
  }
  const server = lanControlServer
  if (!server) throw new Error('LAN control is not initialized.')
  if (!(await server.revokeClient(clientId))) {
    throw new Error('That paired device is no longer available.')
  }
  return getSnapshot()
}

async function resetLanIdentity(): Promise<AppSnapshot> {
  const server = lanControlServer
  if (!server || !controlWindow || controlWindow.isDestroyed()) {
    throw new Error('LAN control or the Rockfall control window is unavailable.')
  }
  const confirmation = await dialog.showMessageBox(controlWindow, {
    type: 'warning',
    title: 'Reset LAN identity',
    message: 'Reset secure LAN pairing?',
    detail:
      'Every paired phone will be disconnected and must compare the new certificate code before pairing again.',
    buttons: ['Cancel', 'Reset identity'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  if (confirmation.response === 1) {
    await enqueueSettingsMutation(() => server.resetIdentity())
  }
  return getSnapshot()
}

async function refreshStaticDataAvailability(): Promise<void> {
  const controller = cloudSyncController
  const archive = gameDataArchive
  const channel = archive?.channel
  if (!controller || cloudSync.user?.role !== 'admin' || !channel) {
    staticData = {
      status: 'unavailable',
      canPublish: false,
      message: channel
        ? 'Sign in as an administrator to publish static data.'
        : 'Select a valid Star Citizen game archive before publishing.',
      progress: null,
      currentRelease: null
    }
    broadcastSnapshot()
    return
  }

  const previousRelease = staticData.currentRelease
  staticData = {
    ...staticData,
    status: 'checking',
    canPublish: false,
    message: 'Checking the static-data contract and current release…',
    progress: null
  }
  broadcastSnapshot()
  try {
    const archiveStat = await stat(archive.path)
    const overview = await controller.getStaticDataOverview(channel)
    const sourceMatches =
      overview.source !== null &&
      overview.source.dataP4kBytes === archiveStat.size &&
      Date.parse(overview.source.dataP4kLastWriteAt) === archiveStat.mtime.getTime()
    staticData = {
      status: overview.canPublish ? 'ready' : 'unavailable',
      canPublish: overview.canPublish,
      message: overview.canPublish
        ? overview.currentRelease
          ? sourceMatches
            ? `Current: the server release matches the selected ${overview.currentRelease.gameBuild} archive.`
            : `Stale or unknown: the selected archive differs from server release ${overview.currentRelease.gameBuild}.`
          : 'Compatible API found. This channel has no published release yet.'
        : 'The current account or API deployment cannot publish this static-data contract.',
      progress: null,
      currentRelease: overview.currentRelease
    }
  } catch (error) {
    staticData = {
      status: 'unavailable',
      canPublish: false,
      message: `Static-data compatibility could not be checked: ${getErrorMessage(error)}`,
      progress: null,
      currentRelease: previousRelease
    }
  }
  broadcastSnapshot()
}

function publishStaticData(): Promise<StaticDataSyncState> {
  if (staticDataPublication) {
    return Promise.reject(new Error('A static-data publication is already in progress.'))
  }
  const request = runStaticDataPublication().finally(() => {
    if (staticDataPublication === request) staticDataPublication = null
  })
  staticDataPublication = request
  return request
}

async function refreshStarStringsState(): Promise<StarStringsSyncState> {
  try {
    const gamePath = await resolveLiveGamePath(gameDataArchive)
    if (!gamePath) {
      starStrings = {
        status: 'unavailable',
        gamePath: null,
        message:
          'No LIVE installation was detected. Select LIVE/Data.p4k as the game-data source to use a custom install location.',
        progress: null,
        installedRelease: null,
        availableRelease: null,
        localizationSource
      }
      broadcastSnapshot([controlWindow])
      return starStrings
    }

    const inspection = await inspectStarStringsInstallation(starStringsRecordPath, gamePath)
    const message = inspection.warning
      ? inspection.warning
      : inspection.installedRelease
        ? `${inspection.installedRelease.name} is installed. Sync to check GitHub for a newer release.`
        : inspection.localizationPresent
          ? 'An existing English localization file was found. Sync to replace it with the latest StarStrings release.'
          : 'LIVE is ready. Sync to download and install the latest StarStrings release.'
    starStrings = {
      status: 'ready',
      gamePath,
      message,
      progress: null,
      installedRelease: inspection.installedRelease,
      availableRelease: null,
      localizationSource
    }
  } catch (error) {
    starStrings = {
      ...starStrings,
      status: 'error',
      message: `The StarStrings installation could not be inspected: ${getErrorMessage(error)}`,
      progress: null
    }
  }
  broadcastSnapshot([controlWindow])
  return starStrings
}

function syncStarStrings(): Promise<StarStringsSyncState> {
  if (starStringsOperation) {
    return Promise.reject(new Error('A StarStrings sync is already in progress.'))
  }
  const request = runStarStringsSync().finally(() => {
    if (starStringsOperation === request) starStringsOperation = null
  })
  starStringsOperation = request
  return request
}

async function runStarStringsSync(): Promise<StarStringsSyncState> {
  let gamePath: string | null = null
  try {
    gamePath = await resolveLiveGamePath(gameDataArchive)
    if (!gamePath) return refreshStarStringsState()
    const inspection = await inspectStarStringsInstallation(starStringsRecordPath, gamePath)
    starStrings = {
      status: 'checking',
      gamePath,
      message: 'Checking the latest StarStrings LIVE release on GitHub…',
      progress: null,
      installedRelease: inspection.installedRelease,
      availableRelease: null,
      localizationSource
    }
    broadcastSnapshot([controlWindow])

    const release = await fetchLatestStarStringsRelease()
    const releaseSummary = {
      version: release.version,
      name: release.name,
      publishedAt: release.publishedAt
    }
    if (inspection.installedRelease?.version === release.version) {
      starStrings = {
        ...starStrings,
        status: 'current',
        message: `${release.name} is already installed and matches the latest GitHub release.`,
        availableRelease: releaseSummary
      }
      broadcastSnapshot([controlWindow])
      return starStrings
    }

    starStrings = {
      ...starStrings,
      status: 'downloading',
      message: `Downloading ${release.name}…`,
      progress: 0,
      availableRelease: releaseSummary
    }
    broadcastSnapshot([controlWindow])

    const installation = await downloadAndInstallStarStrings({
      release,
      livePath: gamePath,
      recordPath: starStringsRecordPath,
      onProgress: ({ stage, percentage }) => {
        starStrings = {
          ...starStrings,
          status: stage,
          message:
            stage === 'downloading'
              ? `Downloading ${release.name}…`
              : 'Installing localization files and preserving USER.cfg…',
          progress: percentage
        }
        broadcastSnapshot([controlWindow])
      }
    })
    starStrings = {
      status: 'installed',
      gamePath,
      message: `${installation.name} is installed. Restart Star Citizen to load the updated strings.`,
      progress: null,
      installedRelease: installation,
      availableRelease: releaseSummary,
      localizationSource
    }
  } catch (error) {
    starStrings = {
      ...starStrings,
      gamePath: gamePath ?? starStrings.gamePath,
      status: 'error',
      message: `StarStrings sync failed: ${getErrorMessage(error)}`,
      progress: null
    }
  }
  broadcastSnapshot([controlWindow])
  return starStrings
}

async function setLocalizationSource(source: unknown): Promise<AppSnapshot> {
  if (source !== 'game' && source !== 'global-ini') {
    throw new TypeError('Localization source must be game or global-ini.')
  }
  if (staticDataPublication) {
    throw new Error('Localization cannot be changed during static-data publication.')
  }
  if (starStringsOperation) {
    throw new Error('Localization cannot be changed during StarStrings sync.')
  }
  if (source === localizationSource) return getSnapshot()

  await validateLocalizationSource(source, gameDataArchive)
  await saveLocalizationSource(localizationSourcePath, source)
  localizationSource = source
  starStrings = { ...starStrings, localizationSource }
  blueprintDataGeneration += 1
  blueprintDataResult = null
  factionDataGeneration += 1
  factionDataResult = null
  await refreshStarStringsState()
  return refreshMaterials()
}

async function runStaticDataPublication(): Promise<StaticDataSyncState> {
  const controller = cloudSyncController
  if (!controller || cloudSync.user?.role !== 'admin') {
    throw new Error('An active administrator session is required to publish static data.')
  }
  const archive = gameDataArchive
  if (!archive) throw new Error('Select a valid Star Citizen game archive before publishing.')
  if (
    gameDataSelectionActive ||
    dataStatus.state === 'loading' ||
    pendingBlueprintData ||
    pendingFactionData
  ) {
    throw new Error('Wait for the current game-data operation to finish before publishing.')
  }

  const priorRelease = staticData.currentRelease
  try {
    await refreshStaticDataAvailability()
    if (!staticData.canPublish || cloudSync.user?.role !== 'admin') {
      throw new Error(staticData.message)
    }

    setStaticDataProgress({
      phase: 'validating',
      completed: 0,
      total: 6,
      message: 'Validating the selected game archive…'
    })
    const prepared = await prepareStaticData({
      gameDataArchive: archive,
      miningCachePath: cachePath,
      miningCatalogCachePath,
      blueprintCachePath: blueprintCatalogCachePath,
      factionCachePath: factionCatalogCachePath,
      extractorPath,
      desktopVersion: app.getVersion(),
      localizationSource,
      onProgress: setStaticDataProgress
    })
    await enqueueSettingsMutation(async () => {
      applyPreparedStaticData(prepared)
    })

    staticData = {
      ...staticData,
      status: 'confirming',
      canPublish: false,
      message: 'Review the prepared release before publishing.',
      progress: null
    }
    broadcastSnapshot()
    const confirmed = await confirmStaticDataPublication(prepared)
    if (!confirmed) {
      staticData = {
        ...staticData,
        status: 'ready',
        canPublish: true,
        message: 'Static-data publication was cancelled.',
        progress: null
      }
      broadcastSnapshot()
      return staticData
    }

    const preUpload = await controller.getStaticDataOverview(archive.channel)
    if (!preUpload.canPublish || cloudSync.user?.role !== 'admin') {
      throw new Error('Administrator access changed before upload. Sign in again if needed.')
    }
    staticData = {
      ...staticData,
      status: 'uploading',
      canPublish: false,
      message: 'Uploading the complete static-data release…',
      progress: {
        phase: 'Uploading release',
        completed: 0,
        total: prepared.publication.archive.byteLength
      }
    }
    broadcastSnapshot()
    const result = await controller.publishStaticDataRelease(
      prepared.publication.archive,
      (sentBytes, totalBytes) => {
        staticData = {
          ...staticData,
          status: sentBytes >= totalBytes ? 'validating' : 'uploading',
          message:
            sentBytes >= totalBytes
              ? 'Upload complete. The server is validating and activating the release…'
              : 'Uploading the complete static-data release…',
          progress: {
            phase: sentBytes >= totalBytes ? 'Validating and publishing' : 'Uploading release',
            completed: sentBytes,
            total: totalBytes
          }
        }
        broadcastSnapshot()
      }
    )
    const currentRelease: StaticDataReleaseSummary = result
    staticData = {
      status: result.status === 'alreadyPublished' ? 'already-current' : 'published',
      canPublish: true,
      message:
        result.status === 'alreadyPublished'
          ? `Already current: ${result.gameBuild} matches the active release.`
          : `Published ${result.gameBuild} atomically to ${result.channel}.`,
      progress: null,
      currentRelease
    }
    broadcastSnapshot()
    return staticData
  } catch (error) {
    staticData = {
      status: 'error',
      canPublish: cloudSync.user?.role === 'admin',
      message: `Static-data publication failed: ${getErrorMessage(error)}`,
      progress: null,
      currentRelease: priorRelease
    }
    broadcastSnapshot()
    throw error
  }
}

function setStaticDataProgress(progress: StaticDataPreparationProgress): void {
  staticData = {
    ...staticData,
    status: 'preparing',
    canPublish: false,
    message: progress.message,
    progress: {
      phase: progress.message,
      completed: progress.completed,
      total: progress.total
    }
  }
  broadcastSnapshot()
}

function applyPreparedStaticData(prepared: PreparedStaticData): void {
  miningLocationGeneration += 1
  miningLocationResults.clear()
  pendingLocationRequests.clear()
  bestMiningLocations = {}
  materials = prepared.mining.materials
  dataStatus = prepared.mining.status
  miningCatalog = prepared.mining.catalog
  miningCatalogMaterialIdByMaterialId = prepared.mining.catalogMaterialIdByMaterialId
  blueprintDataGeneration += 1
  pendingBlueprintData = null
  blueprintDataResult = prepared.blueprints
  factionDataGeneration += 1
  pendingFactionData = null
  factionDataResult = prepared.factions
  broadcastBlueprintCatalog()
  broadcastBlueprintOwnership()
  broadcastSnapshot()
  synchronizeLanState()
  queueSelectedMiningLocations()
}

async function confirmStaticDataPublication(prepared: PreparedStaticData): Promise<boolean> {
  if (!controlWindow || controlWindow.isDestroyed()) {
    throw new Error('The Rockfall control window is unavailable.')
  }
  const resource = Object.fromEntries(
    prepared.publication.manifest.resources.map((entry) => [entry.name, entry])
  )
  const warningCount = prepared.warningCount
  const detail = [
    `API: ${settings.cloudApiUrl}`,
    `Game: ${prepared.source.gameBuild} / ${prepared.source.gameVersion} (${prepared.source.channel})`,
    `Signatures: ${resource.signatures.recordCount} records, ${formatBytes(resource.signatures.compressedBytes)} gzip`,
    `Blueprints: ${resource.blueprints.recordCount} records, ${formatBytes(resource.blueprints.compressedBytes)} gzip`,
    `Factions: ${resource['faction-reputation'].recordCount} records, ${formatBytes(resource['faction-reputation'].compressedBytes)} gzip`,
    `Icons: ${prepared.publication.manifest.assets.length}`,
    `Archive: ${formatBytes(prepared.publication.archive.byteLength)} · SHA-256 ${prepared.publication.archiveSha256.slice(0, 16)}…`,
    `Extractor warnings: ${warningCount}`,
    '',
    'The server will validate every resource and icon before atomically replacing the authenticated current release.'
  ].join('\n')
  const result = await dialog.showMessageBox(controlWindow, {
    type: 'warning',
    title: 'Publish static game data',
    message: 'Publish this complete static-data release?',
    detail,
    buttons: ['Cancel', 'Publish release'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return result.response === 1
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`
  return `${(bytes / 1_048_576).toFixed(1)} MiB`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function refreshMaterials(): Promise<AppSnapshot> {
  if (staticDataPublication) {
    throw new Error('Mining signatures cannot be refreshed during static-data publication.')
  }
  const archive = gameDataArchive
  const generation = await enqueueSettingsMutation(async () => {
    miningLocationGeneration += 1
    miningLocationResults.clear()
    pendingLocationRequests.clear()
    bestMiningLocations = {}
    dataStatus = {
      state: 'loading',
      message: archive
        ? `Reading installed ${archive.channel} game signatures…`
        : 'Refreshing mining signatures…',
      updatedAt: dataStatus.updatedAt
    }
    broadcastSnapshot()
    synchronizeLanState()
    return miningLocationGeneration
  })

  const result = await loadMiningData({
    cachePath,
    miningCatalogCachePath,
    extractorPath,
    gameDataArchive: archive,
    localizationSource
  })

  return enqueueSettingsMutation(async () => {
    if (generation !== miningLocationGeneration) return getSnapshot()
    materials = result.materials
    dataStatus = result.status
    miningCatalog = result.catalog
    miningCatalogMaterialIdByMaterialId = result.catalogMaterialIdByMaterialId

    const availableIds = new Set(materials.map((material) => material.id))
    const selectedMaterialIds = settings.selectedMaterialIds.filter((id) => availableIds.has(id))
    if (selectedMaterialIds.length !== settings.selectedMaterialIds.length) {
      return applySettingsPatch({ selectedMaterialIds })
    }

    broadcastSnapshot()
    synchronizeLanState()
    queueSelectedMiningLocations()
    return getSnapshot()
  })
}

async function chooseGameData(): Promise<GameDataSelectionResult> {
  if (staticDataPublication) {
    throw new Error('Game files cannot be changed during static-data publication.')
  }
  if (gameDataSelectionActive) {
    throw new Error('Game-file selection is already in progress.')
  }
  if (starStringsOperation) {
    throw new Error('Game files cannot be changed during StarStrings sync.')
  }
  if (!controlWindow || controlWindow.isDestroyed()) {
    throw new Error('The Rockfall control window is unavailable.')
  }

  gameDataSelectionActive = true
  try {
    const result = await dialog.showOpenDialog(controlWindow, {
      title: 'Choose Star Citizen game data',
      defaultPath: gameDataArchive?.path,
      buttonLabel: 'Use game data',
      properties: ['openFile'],
      filters: [{ name: 'Star Citizen data archive', extensions: ['p4k'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { snapshot: getSnapshot(), changed: false }
    }

    const archive = await validateGameDataArchive(result.filePaths[0])
    await validateLocalizationSource(localizationSource, archive)
    await saveGameDataPreference(gameDataPreferencePath, archive.path)
    gameDataArchive = archive
    blueprintDataGeneration += 1
    blueprintDataResult = null
    factionDataGeneration += 1
    factionDataResult = null
    const ownershipService = blueprintOwnershipService
    if (ownershipService) {
      runInBackground(
        'Blueprint log monitoring could not be changed',
        ownershipService.configure(archive)
      )
    }
    await refreshStarStringsState()
    const snapshot = await refreshMaterials()
    if (cloudSync.user?.role === 'admin') {
      runInBackground(
        'Static-data compatibility could not be checked',
        refreshStaticDataAvailability()
      )
    }
    return { snapshot, changed: true }
  } finally {
    gameDataSelectionActive = false
  }
}

async function getMiningLocations(materialId: unknown): Promise<MiningLocationResult> {
  if (typeof materialId !== 'string' || materialId.length === 0 || materialId.length > 200) {
    throw new TypeError('A valid mining material is required.')
  }

  const material = materials.find((candidate) => candidate.id === materialId)
  if (!material) throw new Error('That mining material is no longer available.')

  const qualityThreshold = settings.miningQualityThreshold
  const existing = miningLocationResults.get(materialId)
  if (existing?.qualityThreshold === qualityThreshold) return existing

  const pending = pendingLocationRequests.get(materialId)
  if (pending) return pending

  const generation = miningLocationGeneration
  bestMiningLocations = {
    ...bestMiningLocations,
    [materialId]: {
      status: 'loading',
      location: null,
      source: null,
      message: 'Finding the best mining site…'
    }
  }
  broadcastSnapshot()

  const request = loadAndStoreMiningLocations(material, generation, qualityThreshold)
  pendingLocationRequests.set(materialId, request)
  try {
    return await request
  } finally {
    if (pendingLocationRequests.get(materialId) === request) {
      pendingLocationRequests.delete(materialId)
    }
  }
}

async function loadAndStoreMiningLocations(
  material: MiningMaterial,
  generation: number,
  qualityThreshold: number
): Promise<MiningLocationResult> {
  try {
    const result = await loadMiningLocations(
      locationCachePath,
      material,
      miningCatalog,
      miningCatalogMaterialIdByMaterialId.get(material.id) ?? null,
      qualityThreshold,
      () =>
        generation === miningLocationGeneration &&
        qualityThreshold === settings.miningQualityThreshold
    )
    if (
      generation === miningLocationGeneration &&
      qualityThreshold === settings.miningQualityThreshold
    ) {
      miningLocationResults.set(material.id, result)
      bestMiningLocations = {
        ...bestMiningLocations,
        [material.id]: getPreferredMiningLocationState(result)
      }
      broadcastSnapshot()
    }
    return result
  } catch (error) {
    if (generation === miningLocationGeneration) {
      const message = error instanceof Error ? error.message : String(error)
      bestMiningLocations = {
        ...bestMiningLocations,
        [material.id]: {
          status: 'error',
          location: null,
          source: null,
          message
        }
      }
      broadcastSnapshot()
    }
    throw error
  }
}

function getPreferredMiningLocationState(result: MiningLocationResult): BestMiningLocationState {
  const favoriteLocationId = settings.favoriteMiningLocationIds[result.materialId]
  const location = resolvePreferredMiningLocation(result.locations, favoriteLocationId)
  if (!location) {
    return {
      status: 'empty',
      location: null,
      source: result.state,
      message: 'No mining site is reported for this material.'
    }
  }

  return {
    status: 'ready',
    location,
    qualityThreshold: result.qualityThreshold,
    source: result.state,
    message:
      favoriteLocationId === location.id
        ? `Favorite mining site. ${result.message}`
        : result.message
  }
}

function refreshPreferredMiningLocationStates(): void {
  if (miningLocationResults.size === 0) return

  const next = { ...bestMiningLocations }
  for (const [materialId, result] of miningLocationResults) {
    next[materialId] = getPreferredMiningLocationState(result)
  }
  bestMiningLocations = next
}

function queueSelectedMiningLocations(): void {
  for (const materialId of settings.selectedMaterialIds) {
    if (
      miningLocationResults.has(materialId) ||
      pendingLocationRequests.has(materialId) ||
      bestMiningLocations[materialId]?.status === 'error'
    ) {
      continue
    }

    void getMiningLocations(materialId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Best mining site for "${materialId}" could not be loaded: ${message}`)
    })
  }
}

async function getBlueprintCatalog(refresh: unknown = false): Promise<BlueprintCatalogResult> {
  if (typeof refresh !== 'boolean') {
    throw new TypeError('Blueprint refresh state must be a boolean.')
  }
  if (staticDataPublication && (refresh || !blueprintDataResult)) {
    throw new Error('Blueprint data cannot be refreshed during static-data publication.')
  }
  const generation = blueprintDataGeneration
  if (!refresh && blueprintDataResult) return blueprintDataResult.catalog
  if (pendingBlueprintData?.generation === generation) {
    return (await (refresh ? pendingBlueprintData.request : pendingBlueprintData.visible)).catalog
  }

  const preparation = prepareBlueprintDataLoad({
    cachePath: blueprintCatalogCachePath,
    extractorPath,
    gameDataArchive,
    localizationSource,
    forceRefresh: refresh,
    shouldWriteCache: () => generation === blueprintDataGeneration
  })
  const request = preparation
    .then(({ refreshed }) => refreshed)
    .then((result) => {
      if (generation === blueprintDataGeneration) {
        blueprintDataResult = result
        broadcastBlueprintCatalog()
        broadcastBlueprintOwnership()
        if (cloudSyncController) {
          runInBackground(
            'Local blueprint ownership could not be queued for cloud sync',
            cloudSyncController.captureLocalChanges()
          )
        }
      }
      return result
    })
  const visible = preparation.then(async ({ cached }) => {
    if (!refresh && cached) {
      if (generation === blueprintDataGeneration) {
        blueprintDataResult = cached
        broadcastBlueprintOwnership()
      }
      return cached
    }
    return request
  })
  const pending = { generation, visible, request }
  pendingBlueprintData = pending
  const clearPending = (): void => {
    if (pendingBlueprintData === pending) pendingBlueprintData = null
  }
  void request.then(clearPending, clearPending)
  return (await visible).catalog
}

async function getFactionCatalog(refresh: unknown = false): Promise<FactionCatalogResult> {
  if (typeof refresh !== 'boolean') {
    throw new TypeError('Faction refresh state must be a boolean.')
  }
  if (staticDataPublication && (refresh || !factionDataResult)) {
    throw new Error('Faction data cannot be refreshed during static-data publication.')
  }
  const generation = factionDataGeneration
  if (pendingFactionData?.generation === generation) {
    return pendingFactionData.request
  }
  if (!refresh && factionDataResult) return factionDataResult

  const request = loadFactionData({
    cachePath: factionCatalogCachePath,
    extractorPath,
    gameDataArchive,
    localizationSource,
    forceRefresh: refresh,
    shouldWriteCache: () => generation === factionDataGeneration
  })
  const pending = { generation, request }
  pendingFactionData = pending
  try {
    const result = await request
    if (generation === factionDataGeneration) factionDataResult = result
    return result
  } finally {
    if (pendingFactionData === pending) pendingFactionData = null
  }
}

async function getBlueprintOwnership(): Promise<BlueprintOwnershipSnapshot> {
  const service = blueprintOwnershipService
  if (!service) throw new Error('Blueprint ownership is not initialized.')
  if (!blueprintDataResult) await getBlueprintCatalog()
  const data = blueprintDataResult
  if (!data) throw new Error('Blueprint catalog data is unavailable.')
  return service.getSnapshot(
    data.catalog.blueprints,
    cloudSyncController?.getOwnershipLayer() ?? null
  )
}

async function rescanBlueprintOwnership(): Promise<BlueprintOwnershipSnapshot> {
  const service = blueprintOwnershipService
  if (!service) throw new Error('Blueprint ownership is not initialized.')
  await service.rescan()
  return getBlueprintOwnership()
}

async function setBlueprintOwned(
  blueprintId: unknown,
  owned: unknown
): Promise<BlueprintOwnershipSnapshot> {
  if (typeof blueprintId !== 'string' || blueprintId.length === 0 || blueprintId.length > 200) {
    throw new TypeError('A valid blueprint is required.')
  }
  if (typeof owned !== 'boolean') {
    throw new TypeError('Blueprint ownership state must be a boolean.')
  }

  if (!blueprintDataResult) await getBlueprintCatalog()
  const data = blueprintDataResult
  const service = blueprintOwnershipService
  const blueprint = data?.details[blueprintId]
  if (!data || !service || !blueprint) {
    throw new Error('That blueprint is no longer available.')
  }

  const current = service.getSnapshot(data.catalog.blueprints)
  const record = current.records[blueprintId]
  if (owned && record && record.source !== 'manual') return current
  if (!owned && record && record.source !== 'manual') {
    throw new Error('Only manually marked blueprint ownership can be cleared.')
  }

  const cloudController = cloudSyncController
  const keyIsUnique =
    data.catalog.blueprints.filter((candidate) => candidate.key === blueprint.key).length === 1
  suppressCloudOwnershipCapture = true
  try {
    await service.setManualOwned(
      blueprint,
      owned,
      cloudController
        ? (identity) =>
            cloudController
              .recordManualChange(identity, {
                blueprintId: blueprint.id,
                blueprintKey: blueprint.key,
                owned,
                keyIsUnique
              })
              .then(() => undefined)
        : undefined,
      keyIsUnique
    )
  } finally {
    suppressCloudOwnershipCapture = false
  }
  if (cloudController) await cloudController.syncNow()
  return getBlueprintOwnership()
}

async function getBlueprintDetail(blueprintId: unknown): Promise<BlueprintDetailResult> {
  if (typeof blueprintId !== 'string' || blueprintId.length === 0 || blueprintId.length > 200) {
    throw new TypeError('A valid blueprint is required.')
  }

  if (!blueprintDataResult) await getBlueprintCatalog()
  const data = blueprintDataResult
  const blueprint = data?.details[blueprintId]
  if (!blueprint) {
    throw new Error('That blueprint is no longer available.')
  }
  return {
    blueprint,
    state: data.catalog.state,
    message: data.catalog.message,
    updatedAt: data.catalog.updatedAt
  }
}

async function getBlueprintThumbnail(blueprintId: unknown): Promise<BlueprintThumbnailResult> {
  if (typeof blueprintId !== 'string' || blueprintId.length === 0 || blueprintId.length > 200) {
    throw new TypeError('A valid blueprint is required.')
  }
  if (!blueprintDataResult) await getBlueprintCatalog()
  const data = blueprintDataResult
  const blueprint = data?.details[blueprintId]
  if (!data || !blueprint) {
    throw new Error('That blueprint is no longer available.')
  }

  const packagedIcon = blueprint.imageKey ? data.catalog.icons[blueprint.imageKey] : null
  if (packagedIcon) {
    return {
      status: 'ready' as const,
      dataUrl: packagedIcon,
      message: 'Packaged icon extracted from installed game files.'
    }
  }
  if (!blueprintThumbnailService) {
    return {
      status: 'unavailable' as const,
      dataUrl: null,
      message: 'Local thumbnail generation is not initialized.'
    }
  }
  return blueprintThumbnailService.get(blueprint)
}

function loadRenderer(window: BrowserWindow, view: 'control' | 'overlay' | 'drag-handle'): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('view', view)
    runInBackground(`${view} renderer could not be loaded`, window.loadURL(url.toString()))
  } else {
    runInBackground(
      `${view} renderer could not be loaded`,
      window.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { view }
      })
    )
  }
}

function secureExternalNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      runInBackground('The external link could not be opened', shell.openExternal(url))
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (url !== currentUrl) event.preventDefault()
  })
}

function showControlWindow(): void {
  if (!controlWindow || controlWindow.isDestroyed()) {
    controlWindow = createControlWindow()
    return
  }
  if (controlWindow.isMinimized()) controlWindow.restore()
  controlWindow.show()
  controlWindow.focus()
}

function handleProtocolUrl(value: string): void {
  if (!value.startsWith('rockfall://')) return
  if (!cloudSyncController || !appInitialized) {
    pendingProtocolUrls.push(value)
    return
  }
  showControlWindow()
  const controller = cloudSyncController
  runInBackground(
    'Discord sign-in could not be completed',
    Promise.resolve().then(() => controller.handleLoginUrl(value))
  )
}

function runWithQuitIntent(action: () => void): void {
  isQuitting = true
  try {
    action()
  } catch (error) {
    isQuitting = false
    throw error
  }
}

function createAppTray(): Tray {
  const appTray = new Tray(icon)
  appTray.setToolTip('Rockfall Field Console')
  appTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Rockfall', click: showControlWindow },
      { type: 'separator' },
      { label: 'Quit Rockfall', click: () => runWithQuitIntent(() => app.quit()) }
    ])
  )
  appTray.on('click', showControlWindow)
  return appTray
}

function createControlWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Rockfall',
    icon,
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#101113',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => {
    controlWindow = null
  })
  secureExternalNavigation(window)
  loadRenderer(window, 'control')
  return window
}

function createOverlayWindow(): BrowserWindow {
  const { width, height } = getOverlayLayout()
  const size = { width, height }
  const position = getOverlayPosition(settings.placement, size)
  const window = new BrowserWindow({
    title: 'Rockfall Overlay',
    ...position,
    ...size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.setAlwaysOnTop(true, 'screen-saver')
  window.setIgnoreMouseEvents(true, { forward: true })
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.on('ready-to-show', applyOverlayState)
  window.on('closed', () => {
    overlayWindow = null
  })
  secureExternalNavigation(window)
  loadRenderer(window, 'overlay')
  return window
}

function createDragHandleWindow(): BrowserWindow {
  const { width, height, headerHeight } = getOverlayLayout()
  const size = { width, height }
  const position = getOverlayPosition(settings.placement, size)
  const window = new BrowserWindow({
    title: 'Rockfall Drag Handle',
    ...position,
    width: size.width,
    height: headerHeight,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setShape([{ x: 0, y: 0, width: size.width, height: headerHeight }])
  window.on('ready-to-show', applyOverlayState)
  window.on('move', syncOverlayToDragHandle)
  window.on('moved', persistOverlayPosition)
  window.on('closed', () => {
    dragHandleWindow = null
  })
  loadRenderer(window, 'drag-handle')
  return window
}

function registerShortcuts(): ShortcutStatus[] {
  globalShortcut.unregisterAll()
  return SHORTCUT_DEFINITIONS.map(({ action, ...shortcut }) => {
    const accelerator = settings.shortcuts[shortcut.id]
    try {
      const registered = globalShortcut.register(accelerator, action)
      return { ...shortcut, accelerator, registered }
    } catch (error) {
      console.error(`Shortcut "${accelerator}" could not be registered.`, error)
      return { ...shortcut, accelerator, registered: false }
    }
  })
}

function setShortcutCapture(active: boolean): AppSnapshot {
  shortcutCaptureActive = active
  if (active) {
    globalShortcut.unregisterAll()
  } else {
    shortcutStatuses = registerShortcuts()
  }
  broadcastSnapshot()
  return getSnapshot()
}

function assertControlWindowSender(event: IpcMainInvokeEvent): void {
  if (!controlWindow || controlWindow.isDestroyed() || event.sender !== controlWindow.webContents) {
    throw new Error('This action is only available from the Rockfall control window.')
  }
}

function assertDragHandleWindowSender(event: IpcMainInvokeEvent): void {
  if (
    !dragHandleWindow ||
    dragHandleWindow.isDestroyed() ||
    event.sender !== dragHandleWindow.webContents
  ) {
    throw new Error('This action is only available from the overlay header.')
  }
}

function assertOverlayWindowStateSender(event: IpcMainInvokeEvent): void {
  const allowedSenders = [overlayWindow, dragHandleWindow]
    .filter((window): window is BrowserWindow => window !== null && !window.isDestroyed())
    .map((window) => window.webContents)
  if (!allowedSenders.includes(event.sender)) {
    throw new Error('Overlay window state is only available to overlay windows.')
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getSnapshot, () => getSnapshot())
  ipcMain.handle(IPC_CHANNELS.updateSettings, (event, patch: OverlaySettingsPatch) => {
    assertControlWindowSender(event)
    if (
      typeof patch === 'object' &&
      patch !== null &&
      Object.prototype.hasOwnProperty.call(patch, 'lanControl')
    ) {
      throw new Error('Use the dedicated LAN configuration action.')
    }
    return updateSettings(patch)
  })
  ipcMain.handle(IPC_CHANNELS.executeOverlayCommand, (event, command: unknown) => {
    assertControlWindowSender(event)
    return executeOverlayCommand(parseLanOverlayCommand(command))
  })
  ipcMain.handle(IPC_CHANNELS.reportOverlayMetrics, (event, metrics: unknown) => {
    if (
      !overlayWindow ||
      overlayWindow.isDestroyed() ||
      event.sender !== overlayWindow.webContents
    ) {
      throw new Error('Overlay metrics can only be reported by the overlay window.')
    }
    applyMeasuredOverlayMetrics(metrics)
  })
  ipcMain.handle(IPC_CHANNELS.getOverlayWindowState, (event) => {
    assertOverlayWindowStateSender(event)
    return { collapsed: overlayCollapsed }
  })
  ipcMain.handle(IPC_CHANNELS.hideOverlay, async (event) => {
    assertDragHandleWindowSender(event)
    await updateSettings({ visible: false })
  })
  ipcMain.handle(IPC_CHANNELS.setOverlayCollapsed, (event, collapsed: unknown) => {
    assertDragHandleWindowSender(event)
    if (typeof collapsed !== 'boolean') {
      throw new TypeError('Overlay collapsed state must be a boolean.')
    }
    overlayCollapsed = collapsed
    broadcastOverlayWindowState()
    applyOverlayState()
    return { collapsed: overlayCollapsed }
  })
  ipcMain.handle(IPC_CHANNELS.refreshMaterials, () => refreshMaterials())
  ipcMain.handle(IPC_CHANNELS.chooseGameData, (event) => {
    assertControlWindowSender(event)
    return chooseGameData()
  })
  ipcMain.handle(IPC_CHANNELS.getMiningLocations, (event, materialId: unknown) => {
    assertControlWindowSender(event)
    return getMiningLocations(materialId)
  })
  ipcMain.handle(IPC_CHANNELS.getBlueprintCatalog, (event, refresh: unknown) => {
    assertControlWindowSender(event)
    return getBlueprintCatalog(refresh)
  })
  ipcMain.handle(IPC_CHANNELS.getBlueprintDetail, (event, blueprintId: unknown) => {
    assertControlWindowSender(event)
    return getBlueprintDetail(blueprintId)
  })
  ipcMain.handle(IPC_CHANNELS.getBlueprintThumbnail, (event, blueprintId: unknown) => {
    assertControlWindowSender(event)
    return getBlueprintThumbnail(blueprintId)
  })
  ipcMain.handle(IPC_CHANNELS.getFactionCatalog, (event, refresh: unknown) => {
    assertControlWindowSender(event)
    return getFactionCatalog(refresh)
  })
  ipcMain.handle(IPC_CHANNELS.getBlueprintOwnership, (event) => {
    assertControlWindowSender(event)
    return getBlueprintOwnership()
  })
  ipcMain.handle(IPC_CHANNELS.rescanBlueprintOwnership, (event) => {
    assertControlWindowSender(event)
    return rescanBlueprintOwnership()
  })
  ipcMain.handle(IPC_CHANNELS.setBlueprintOwned, (event, blueprintId: unknown, owned: unknown) => {
    assertControlWindowSender(event)
    return setBlueprintOwned(blueprintId, owned)
  })
  ipcMain.handle(IPC_CHANNELS.setShortcutCapture, (_event, active: unknown) => {
    if (typeof active !== 'boolean') {
      throw new TypeError('Shortcut capture state must be a boolean.')
    }
    return setShortcutCapture(active)
  })
  ipcMain.handle(IPC_CHANNELS.beginCloudLogin, (event) => {
    assertControlWindowSender(event)
    if (!cloudSyncController) throw new Error('Cloud sync is not initialized.')
    return cloudSyncController.beginLogin()
  })
  ipcMain.handle(IPC_CHANNELS.completeCloudLogin, (event, handoffCode: unknown) => {
    assertControlWindowSender(event)
    if (!cloudSyncController) throw new Error('Cloud sync is not initialized.')
    if (
      typeof handoffCode !== 'string' ||
      handoffCode.trim().length === 0 ||
      handoffCode.length > 2_000
    ) {
      throw new TypeError('A valid Discord handoff code is required.')
    }
    return cloudSyncController.completeLoginCode(handoffCode)
  })
  ipcMain.handle(IPC_CHANNELS.cancelCloudLogin, (event) => {
    assertControlWindowSender(event)
    if (!cloudSyncController) throw new Error('Cloud sync is not initialized.')
    return cloudSyncController.cancelLogin()
  })
  ipcMain.handle(IPC_CHANNELS.syncCloud, (event) => {
    assertControlWindowSender(event)
    if (!cloudSyncController) throw new Error('Cloud sync is not initialized.')
    return cloudSyncController.syncNow()
  })
  ipcMain.handle(IPC_CHANNELS.confirmCloudProfileImport, async (event) => {
    assertControlWindowSender(event)
    if (!cloudSyncController || !controlWindow) {
      throw new Error('Cloud sync is not initialized.')
    }
    const confirmation = await dialog.showMessageBox(controlWindow, {
      type: 'warning',
      title: 'Import local ownership',
      message: 'Import profiles linked to another Discord account?',
      detail:
        'This uploads the selected local Star Citizen ownership profiles to the currently signed-in Discord account.',
      buttons: ['Cancel', 'Import profiles'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    return confirmation.response === 1
      ? cloudSyncController.confirmProfileImport()
      : cloudSyncController.getSnapshot()
  })
  ipcMain.handle(IPC_CHANNELS.logoutCloud, (event) => {
    assertControlWindowSender(event)
    if (!cloudSyncController) throw new Error('Cloud sync is not initialized.')
    return cloudSyncController.logout()
  })
  ipcMain.handle(IPC_CHANNELS.publishStaticData, (event) => {
    assertControlWindowSender(event)
    return publishStaticData()
  })
  ipcMain.handle(IPC_CHANNELS.syncStarStrings, (event) => {
    assertControlWindowSender(event)
    return syncStarStrings()
  })
  ipcMain.handle(IPC_CHANNELS.setLocalizationSource, (event, source: unknown) => {
    assertControlWindowSender(event)
    return setLocalizationSource(source)
  })
  ipcMain.handle(IPC_CHANNELS.checkForUpdates, async (event) => {
    assertControlWindowSender(event)
    if (!appUpdater) throw new Error('The application updater is not initialized.')
    await appUpdater.checkForUpdates()
    return getSnapshot()
  })
  ipcMain.handle(IPC_CHANNELS.restartToUpdate, (event) => {
    assertControlWindowSender(event)
    const updater = appUpdater
    if (!updater) throw new Error('The application updater is not initialized.')
    runWithQuitIntent(() => updater.restartToUpdate())
  })
  ipcMain.handle(IPC_CHANNELS.configureLanControl, (event, config: unknown) => {
    assertControlWindowSender(event)
    return configureLanControl(config)
  })
  ipcMain.handle(IPC_CHANNELS.beginLanPairing, (event) => {
    assertControlWindowSender(event)
    return beginLanPairing()
  })
  ipcMain.handle(IPC_CHANNELS.cancelLanPairing, (event) => {
    assertControlWindowSender(event)
    return cancelLanPairing()
  })
  ipcMain.handle(IPC_CHANNELS.revokeLanClient, (event, clientId: unknown) => {
    assertControlWindowSender(event)
    return revokeLanClient(clientId)
  })
  ipcMain.handle(IPC_CHANNELS.resetLanIdentity, (event) => {
    assertControlWindowSender(event)
    return resetLanIdentity()
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleProtocolUrl(url)
})

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const protocolUrl = commandLine.find((argument) => argument.startsWith('rockfall://'))
    if (protocolUrl) handleProtocolUrl(protocolUrl)
    if (appInitialized) {
      showControlWindow()
    } else {
      focusRequestedDuringStartup = true
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('space.rockfall.overlay')
    nativeTheme.themeSource = 'dark'
    settingsPath = join(app.getPath('userData'), 'settings.json')
    cachePath = join(app.getPath('userData'), 'mining-signatures.json')
    miningCatalogCachePath = join(app.getPath('userData'), 'mining-catalog.json')
    locationCachePath = join(app.getPath('userData'), 'mining-locations.json')
    blueprintCatalogCachePath = join(app.getPath('userData'), 'blueprints.json')
    blueprintThumbnailCachePath = join(app.getPath('userData'), 'blueprint-thumbnails')
    blueprintThumbnailTemporaryPath = join(app.getPath('temp'), 'rockfall-blueprint-thumbnails')
    factionCatalogCachePath = join(app.getPath('userData'), 'factions.json')
    blueprintOwnershipPath = join(app.getPath('userData'), 'blueprint-ownership.json')
    cloudStatePath = join(app.getPath('userData'), 'cloud-state.json')
    gameDataPreferencePath = join(app.getPath('userData'), 'game-data.json')
    starStringsRecordPath = join(app.getPath('userData'), 'starstrings.json')
    localizationSourcePath = join(app.getPath('userData'), 'localization.json')
    lanControlPath = join(app.getPath('userData'), 'lan-control.json')
    extractorPath = app.isPackaged
      ? join(process.resourcesPath, 'game-data-extractor', 'Rockfall.GameDataExtractor.exe')
      : join(
          app.getAppPath(),
          'tools',
          'game-data-extractor',
          'bin',
          'Release',
          'net8.0',
          'win-x64',
          'publish',
          'Rockfall.GameDataExtractor.exe'
        )

    blueprintOwnershipService = new BlueprintOwnershipService({
      storePath: blueprintOwnershipPath,
      onChange: handleBlueprintOwnershipChange
    })
    blueprintThumbnailService = new BlueprintThumbnailService({
      cacheDirectory: blueprintThumbnailCachePath,
      temporaryDirectory: blueprintThumbnailTemporaryPath,
      extractorPath,
      converterPath:
        process.env.ROCKFALL_CGF_CONVERTER ?? 'cgf-converter.exe',
      getGameDataArchive: () => gameDataArchive
    })
    const [loaded, gameDataPreference, loadedLocalization] = await Promise.all([
      loadSettings(settingsPath),
      loadGameDataPreference(gameDataPreferencePath),
      loadLocalizationSource(localizationSourcePath),
      blueprintOwnershipService.initialize()
    ])
    let gameDataResolutionWarning: string | null = null
    try {
      gameDataArchive = await resolveGameDataArchive(gameDataPreference.preferredPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      gameDataResolutionWarning = `The configured game data location is unavailable: ${message}`
    }
    settings = loaded.settings
    localizationSource = loadedLocalization.source
    starStrings = { ...starStrings, localizationSource }
    lanControlState = {
      ...lanControlState,
      enabled: settings.lanControl.enabled,
      port: settings.lanControl.port
    }
    warning =
      [
        loaded.warning,
        gameDataPreference.warning,
        loadedLocalization.warning,
        gameDataResolutionWarning
      ]
        .filter(Boolean)
        .join(' ') || null
    const lanControlStore = new LanControlStore({
      path: lanControlPath,
      protector: {
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
        decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64'))
      }
    })
    lanControlServer = new LanControlServer({
      store: lanControlStore,
      deviceName: hostname().trim().slice(0, 80) || 'Windows PC',
      appVersion: app.getVersion(),
      getDomainState: getLanDomainState,
      executeCommand: executeLanCommand,
      onRuntimeStateChange: (state) => {
        lanControlState = state
        broadcastSnapshot([controlWindow])
      }
    })
    if (settings.lanControl.enabled) {
      try {
        await lanControlServer.start(settings.lanControl.port)
      } catch (error) {
        console.error('LAN control could not be started.', error)
      }
    } else {
      try {
        await lanControlServer.loadIdentityIfPresent()
      } catch (error) {
        console.error('Saved LAN pairing metadata could not be loaded.', error)
      }
    }
    await refreshStarStringsState()
    cloudSyncController = new CloudSyncController({
      storePath: cloudStatePath,
      apiUrl: settings.cloudApiUrl,
      appVersion: app.getVersion(),
      deviceName: hostname().trim().slice(0, 200) || 'Windows PC',
      tokenProtector: {
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
        decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64'))
      },
      getLocalProfiles: () => {
        const ownershipService = blueprintOwnershipService
        if (!ownershipService) return []
        const catalog = blueprintDataResult?.catalog.blueprints
        return ownershipService.getSyncProfiles(catalog, catalog !== undefined)
      },
      prepareLocalProfiles: async () => {
        if (!blueprintDataResult) await getBlueprintCatalog()
      },
      isBlueprintKeyUnique: (blueprintKey) =>
        blueprintDataResult?.catalog.blueprints.filter(
          (blueprint) => blueprint.key === blueprintKey
        ).length === 1,
      getActiveProfile: () => blueprintOwnershipService?.getActiveProfileIdentity() ?? null,
      openExternal: (url) => shell.openExternal(url),
      onStateChange: (state) => {
        const wasAdmin = cloudSync.user?.role === 'admin'
        cloudSync = state
        const isAdmin = state.user?.role === 'admin'
        if (!isAdmin) {
          staticData = {
            status: 'unavailable',
            canPublish: false,
            message: 'Sign in as an administrator to publish static data.',
            progress: null,
            currentRelease: staticData.currentRelease
          }
        } else if (!wasAdmin && !staticDataPublication) {
          runInBackground(
            'Static-data compatibility could not be checked',
            refreshStaticDataAvailability()
          )
        }
        broadcastSnapshot([controlWindow])
      },
      onOwnershipChange: broadcastBlueprintOwnership
    })
    await cloudSyncController.initialize()
    cloudSync = cloudSyncController.getSnapshot()
    appUpdater = new AppUpdaterController(createUpdaterClient(autoUpdater), {
      enabled: app.isPackaged,
      currentVersion: app.getVersion(),
      onStateChange: (state) => {
        appUpdate = state
        broadcastSnapshot([controlWindow])
      }
    })
    appUpdate = appUpdater.getState()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    tray = createAppTray()
    controlWindow = createControlWindow()
    overlayWindow = createOverlayWindow()
    dragHandleWindow = createDragHandleWindow()
    appInitialized = true
    for (const protocolUrl of pendingProtocolUrls.splice(0)) {
      handleProtocolUrl(protocolUrl)
    }
    if (focusRequestedDuringStartup) {
      focusRequestedDuringStartup = false
      showControlWindow()
    }
    if (loaded.needsSave) {
      runInBackground(
        'Updated overlay defaults could not be saved',
        enqueueSettingsMutation(() => saveSettings(settingsPath, settings))
      )
    }
    shortcutStatuses = registerShortcuts()
    broadcastSnapshot()
    appUpdater.start()
    runInBackground('Mining signatures could not be refreshed', refreshMaterials())
    if (gameDataArchive) {
      runInBackground('Blueprint catalog could not be prepared', getBlueprintCatalog())
    }
    runInBackground(
      'Blueprint logs could not be monitored',
      blueprintOwnershipService.configure(gameDataArchive)
    )

    app.on('activate', () => {
      showControlWindow()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', (event) => {
  if (!lanShutdownComplete && lanControlServer) {
    event.preventDefault()
    if (!lanShutdownInProgress) {
      lanShutdownInProgress = true
      void withTimeout(lanControlServer.dispose(), LAN_SHUTDOWN_TIMEOUT_MS)
        .catch((error: unknown) => {
          console.error('LAN control could not be stopped cleanly.', error)
        })
        .finally(() => {
          lanShutdownComplete = true
          app.quit()
        })
    }
    return
  }
  appUpdater?.stop()
  cloudSyncController?.dispose()
  blueprintOwnershipService?.dispose()
  globalShortcut.unregisterAll()
  if (overlayPositionTimer) clearTimeout(overlayPositionTimer)
  tray?.destroy()
  tray = null
})

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Operation did not finish within ${timeoutMs} ms.`)),
      timeoutMs
    )
    timer.unref()
  })
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer))
}
