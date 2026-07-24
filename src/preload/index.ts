import { contextBridge, ipcRenderer } from 'electron'

import {
  IPC_CHANNELS,
  type AppSnapshot,
  type OverlayContentMetrics,
  type OverlaySettingsPatch,
  type RockfallApi
} from '../shared/contracts'

const rockfallApi: RockfallApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  updateSettings: (patch: OverlaySettingsPatch) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),
  reportOverlayMetrics: (metrics: OverlayContentMetrics) =>
    ipcRenderer.invoke(IPC_CHANNELS.reportOverlayMetrics, metrics),
  refreshMaterials: () => ipcRenderer.invoke(IPC_CHANNELS.refreshMaterials),
  setShortcutCapture: (active: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setShortcutCapture, active),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  restartToUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.restartToUpdate),
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => {
      listener(snapshot)
    }
    ipcRenderer.on(IPC_CHANNELS.snapshotChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.snapshotChanged, handler)
  }
}

contextBridge.exposeInMainWorld('rockfall', rockfallApi)
