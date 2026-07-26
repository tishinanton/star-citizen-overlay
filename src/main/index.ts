import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
  Tray,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'node:path'

import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'

import {
  IPC_CHANNELS,
  type AppSnapshot,
  type AppUpdateState,
  type BestMiningLocationState,
  type MiningDataStatus,
  type MiningLocationResult,
  type MiningMaterial,
  type OverlayContentMetrics,
  type OverlayPosition,
  type OverlayPlacement,
  type OverlaySettings,
  type OverlaySettingsPatch,
  type ShortcutStatus
} from '../shared/contracts'
import {
  getOverlayFallbackLayout,
  getOverlayLayoutKey,
  type OverlayLayout
} from '../shared/overlay-layout'
import { AppUpdaterController, createUpdaterClient } from './app-updater'
import { loadMiningData } from './mining-data'
import { loadMiningLocations } from './mining-locations'
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, saveSettings } from './settings-store'

const SCREEN_MARGIN = 24

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
    action: () => runInBackground('The next target could not be selected', cycleSpotlight())
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
        updateSettings({ compact: !settings.compact })
      )
  }
]

let controlWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let dragHandleWindow: BrowserWindow | null = null
let tray: Tray | null = null
let settings: OverlaySettings = {
  ...DEFAULT_SETTINGS,
  selectedMaterialIds: [...DEFAULT_SETTINGS.selectedMaterialIds],
  signatureOverrides: { ...DEFAULT_SETTINGS.signatureOverrides },
  shortcuts: { ...DEFAULT_SETTINGS.shortcuts }
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
let shortcutStatuses: ShortcutStatus[] = []
let warning: string | null = null
let settingsPath = ''
let cachePath = ''
let locationCachePath = ''
let appUpdater: AppUpdaterController | null = null
let isQuitting = false
let shortcutCaptureActive = false
let expectedOverlayPosition: OverlayPosition | null = null
let overlayPositionTimer: NodeJS.Timeout | null = null
let measuredOverlayMetrics: OverlayContentMetrics | null = null
let miningLocationGeneration = 0
const miningLocationResults = new Map<string, MiningLocationResult>()
const pendingLocationRequests = new Map<string, Promise<MiningLocationResult>>()

function getSnapshot(): AppSnapshot {
  return {
    materials,
    bestMiningLocations,
    settings,
    dataStatus,
    shortcuts: shortcutStatuses,
    appUpdate,
    warning
  }
}

function broadcastSnapshot(
  targetWindows: ReadonlyArray<BrowserWindow | null> = [controlWindow, overlayWindow]
): void {
  const snapshot = getSnapshot()
  for (const window of targetWindows) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.snapshotChanged, snapshot)
    }
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

  const { width, height, headerHeight } = getOverlayLayout()
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
  const next = mergeSettings(settings, { customPosition: position })
  await saveSettings(settingsPath, next)
  settings = next
  warning = null
  broadcastSnapshot()
}

async function updateSettings(patch: OverlaySettingsPatch): Promise<AppSnapshot> {
  const shortcutsChanged = patch.shortcuts !== undefined
  const next = mergeSettings(settings, patch)
  if (getOverlayLayoutKey(next) !== getOverlayLayoutKey(settings)) {
    measuredOverlayMetrics = null
  }
  await saveSettings(settingsPath, next)
  settings = next
  warning = null
  if (shortcutsChanged && !shortcutCaptureActive) {
    shortcutStatuses = registerShortcuts()
  }
  applyOverlayState()
  broadcastSnapshot()
  queueSelectedMiningLocations()
  return getSnapshot()
}

async function cycleSpotlight(): Promise<void> {
  const selected = settings.selectedMaterialIds
  if (selected.length === 0) {
    await updateSettings({ spotlightMaterialId: null })
    return
  }

  const currentIndex = settings.spotlightMaterialId
    ? selected.indexOf(settings.spotlightMaterialId)
    : -1
  const nextId = selected[(currentIndex + 1) % selected.length]
  await updateSettings({ spotlightMaterialId: nextId })
}

async function refreshMaterials(): Promise<AppSnapshot> {
  miningLocationGeneration += 1
  miningLocationResults.clear()
  pendingLocationRequests.clear()
  bestMiningLocations = {}
  dataStatus = {
    state: 'loading',
    message: 'Refreshing mining signatures…',
    updatedAt: dataStatus.updatedAt
  }
  broadcastSnapshot()

  const result = await loadMiningData(cachePath)
  materials = result.materials
  dataStatus = result.status

  const availableIds = new Set(materials.map((material) => material.id))
  const selectedMaterialIds = settings.selectedMaterialIds.filter((id) => availableIds.has(id))
  if (selectedMaterialIds.length !== settings.selectedMaterialIds.length) {
    const next = mergeSettings(settings, { selectedMaterialIds })
    measuredOverlayMetrics = null
    settings = next
    await saveSettings(settingsPath, settings)
  }

  broadcastSnapshot()
  queueSelectedMiningLocations()
  return getSnapshot()
}

async function getMiningLocations(materialId: unknown): Promise<MiningLocationResult> {
  if (typeof materialId !== 'string' || materialId.length === 0 || materialId.length > 200) {
    throw new TypeError('A valid mining material is required.')
  }

  const material = materials.find((candidate) => candidate.id === materialId)
  if (!material) throw new Error('That mining material is no longer available.')

  const existing = miningLocationResults.get(materialId)
  if (existing) return existing

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

  const request = loadAndStoreMiningLocations(material, generation)
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
  generation: number
): Promise<MiningLocationResult> {
  try {
    const result = await loadMiningLocations(locationCachePath, material)
    if (generation === miningLocationGeneration) {
      miningLocationResults.set(material.id, result)
      bestMiningLocations = {
        ...bestMiningLocations,
        [material.id]: result.locations[0]
          ? {
              status: 'ready',
              location: result.locations[0],
              source: result.state,
              message: result.message
            }
          : {
              status: 'empty',
              location: null,
              source: result.state,
              message: 'No 50%+ quality mining site is reported for this material.'
            }
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
  appTray.setToolTip('Rockfall Mining Overlay')
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
    title: 'Rockfall Mining Overlay',
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

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getSnapshot, () => getSnapshot())
  ipcMain.handle(IPC_CHANNELS.updateSettings, (_event, patch: OverlaySettingsPatch) =>
    updateSettings(patch)
  )
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
  ipcMain.handle(IPC_CHANNELS.refreshMaterials, () => refreshMaterials())
  ipcMain.handle(IPC_CHANNELS.getMiningLocations, (event, materialId: unknown) => {
    assertControlWindowSender(event)
    return getMiningLocations(materialId)
  })
  ipcMain.handle(IPC_CHANNELS.setShortcutCapture, (_event, active: unknown) => {
    if (typeof active !== 'boolean') {
      throw new TypeError('Shortcut capture state must be a boolean.')
    }
    return setShortcutCapture(active)
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
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('space.rockfall.overlay')
  nativeTheme.themeSource = 'dark'
  settingsPath = join(app.getPath('userData'), 'settings.json')
  cachePath = join(app.getPath('userData'), 'mining-signatures.json')
  locationCachePath = join(app.getPath('userData'), 'mining-locations.json')

  const loaded = await loadSettings(settingsPath)
  settings = loaded.settings
  warning = loaded.warning
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
  if (loaded.needsSave) {
    runInBackground(
      'Updated overlay defaults could not be saved',
      saveSettings(settingsPath, settings)
    )
  }
  shortcutStatuses = registerShortcuts()
  broadcastSnapshot()
  appUpdater.start()
  runInBackground('Mining signatures could not be refreshed', refreshMaterials())

  app.on('activate', () => {
    showControlWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  appUpdater?.stop()
  globalShortcut.unregisterAll()
  if (overlayPositionTimer) clearTimeout(overlayPositionTimer)
  tray?.destroy()
  tray = null
})
