import { contextBridge, ipcRenderer } from 'electron'

import {
  IPC_CHANNELS,
  type AppSnapshot,
  type BlueprintOwnershipSnapshot,
  type OverlayContentMetrics,
  type OverlaySettingsPatch,
  type OverlayWindowState,
  type RockfallApi
} from '../shared/contracts'
import type {
  LanControlConfig,
  LanOverlayCommandV1,
  LanPairingSession
} from '../shared/lan-control'

const rockfallApi: RockfallApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  updateSettings: (patch: OverlaySettingsPatch) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),
  executeOverlayCommand: (command: LanOverlayCommandV1) =>
    ipcRenderer.invoke(IPC_CHANNELS.executeOverlayCommand, command),
  reportOverlayMetrics: (metrics: OverlayContentMetrics) =>
    ipcRenderer.invoke(IPC_CHANNELS.reportOverlayMetrics, metrics),
  getOverlayWindowState: (): Promise<OverlayWindowState> =>
    ipcRenderer.invoke(IPC_CHANNELS.getOverlayWindowState),
  hideOverlay: () => ipcRenderer.invoke(IPC_CHANNELS.hideOverlay),
  setOverlayCollapsed: (collapsed: boolean): Promise<OverlayWindowState> =>
    ipcRenderer.invoke(IPC_CHANNELS.setOverlayCollapsed, collapsed),
  onOverlayWindowState: (listener: (state: OverlayWindowState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OverlayWindowState): void => {
      listener(state)
    }
    ipcRenderer.on(IPC_CHANNELS.overlayWindowStateChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.overlayWindowStateChanged, handler)
  },
  refreshMaterials: () => ipcRenderer.invoke(IPC_CHANNELS.refreshMaterials),
  chooseGameData: () => ipcRenderer.invoke(IPC_CHANNELS.chooseGameData),
  getMiningLocations: (materialId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMiningLocations, materialId),
  getBlueprintCatalog: (refresh = false) =>
    ipcRenderer.invoke(IPC_CHANNELS.getBlueprintCatalog, refresh),
  getBlueprintDetail: (blueprintId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getBlueprintDetail, blueprintId),
  getBlueprintOwnership: () => ipcRenderer.invoke(IPC_CHANNELS.getBlueprintOwnership),
  rescanBlueprintOwnership: () => ipcRenderer.invoke(IPC_CHANNELS.rescanBlueprintOwnership),
  setBlueprintOwned: (blueprintId: string, owned: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setBlueprintOwned, blueprintId, owned),
  getFactionCatalog: (refresh = false) =>
    ipcRenderer.invoke(IPC_CHANNELS.getFactionCatalog, refresh),
  setShortcutCapture: (active: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setShortcutCapture, active),
  beginCloudLogin: () => ipcRenderer.invoke(IPC_CHANNELS.beginCloudLogin),
  completeCloudLogin: (handoffCode: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.completeCloudLogin, handoffCode),
  cancelCloudLogin: () => ipcRenderer.invoke(IPC_CHANNELS.cancelCloudLogin),
  syncCloud: () => ipcRenderer.invoke(IPC_CHANNELS.syncCloud),
  confirmCloudProfileImport: () => ipcRenderer.invoke(IPC_CHANNELS.confirmCloudProfileImport),
  logoutCloud: () => ipcRenderer.invoke(IPC_CHANNELS.logoutCloud),
  publishStaticData: () => ipcRenderer.invoke(IPC_CHANNELS.publishStaticData),
  syncStarStrings: () => ipcRenderer.invoke(IPC_CHANNELS.syncStarStrings),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  restartToUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.restartToUpdate),
  configureLanControl: (config: LanControlConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.configureLanControl, config),
  beginLanPairing: (): Promise<LanPairingSession> =>
    ipcRenderer.invoke(IPC_CHANNELS.beginLanPairing),
  cancelLanPairing: () => ipcRenderer.invoke(IPC_CHANNELS.cancelLanPairing),
  revokeLanClient: (clientId: string) => ipcRenderer.invoke(IPC_CHANNELS.revokeLanClient, clientId),
  resetLanIdentity: () => ipcRenderer.invoke(IPC_CHANNELS.resetLanIdentity),
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => {
      listener(snapshot)
    }
    ipcRenderer.on(IPC_CHANNELS.snapshotChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.snapshotChanged, handler)
  },
  onBlueprintOwnership: (listener: (snapshot: BlueprintOwnershipSnapshot) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      snapshot: BlueprintOwnershipSnapshot
    ): void => {
      listener(snapshot)
    }
    ipcRenderer.on(IPC_CHANNELS.blueprintOwnershipChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.blueprintOwnershipChanged, handler)
  }
}

contextBridge.exposeInMainWorld('rockfall', rockfallApi)
