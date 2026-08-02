import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_APP_FONT_SIZE,
  type AppSnapshot,
  type CloudSyncState,
  type MiningLocationResult,
  type OverlaySettingsPatch
} from '../../../shared/contracts'
import type {
  LanControlConfig,
  LanOverlayCommandV1,
  LanPairingSession
} from '../../../shared/lan-control'

interface RockfallState {
  snapshot: AppSnapshot | null
  error: string | null
  gameDataSyncing: boolean
  gameDataRevision: number
  updateSettings: (patch: OverlaySettingsPatch) => Promise<void>
  executeOverlayCommand: (command: LanOverlayCommandV1) => Promise<void>
  syncGameData: () => Promise<void>
  chooseGameData: () => Promise<boolean>
  getMiningLocations: (materialId: string) => Promise<MiningLocationResult>
  setShortcutCapture: (active: boolean) => Promise<void>
  beginCloudLogin: () => Promise<void>
  completeCloudLogin: (handoffCode: string) => Promise<void>
  cancelCloudLogin: () => Promise<void>
  syncCloud: () => Promise<void>
  confirmCloudProfileImport: () => Promise<void>
  logoutCloud: () => Promise<void>
  publishStaticData: () => Promise<void>
  syncStarStrings: () => Promise<void>
  checkForUpdates: () => Promise<void>
  restartToUpdate: () => Promise<void>
  configureLanControl: (config: LanControlConfig) => Promise<void>
  beginLanPairing: () => Promise<LanPairingSession | null>
  cancelLanPairing: () => Promise<void>
  revokeLanClient: (clientId: string) => Promise<void>
  resetLanIdentity: () => Promise<void>
}

export function useRockfall(): RockfallState {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gameDataSyncing, setGameDataSyncing] = useState(false)
  const [gameDataRevision, setGameDataRevision] = useState(0)

  useEffect(() => {
    document.documentElement.style.fontSize = `${
      snapshot?.settings.appFontSize ?? DEFAULT_APP_FONT_SIZE
    }px`
  }, [snapshot?.settings.appFontSize])

  useEffect(() => {
    let active = true
    const unsubscribe = window.rockfall.onSnapshot((nextSnapshot) => {
      if (active) {
        setSnapshot(nextSnapshot)
        setError(null)
      }
    })

    window.rockfall
      .getSnapshot()
      .then((nextSnapshot) => {
        if (active) setSnapshot(nextSnapshot)
      })
      .catch((reason: unknown) => {
        if (active) setError(getErrorMessage(reason))
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const updateSettings = useCallback(async (patch: OverlaySettingsPatch): Promise<void> => {
    try {
      setError(null)
      setSnapshot(await window.rockfall.updateSettings(patch))
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  const executeOverlayCommand = useCallback(async (command: LanOverlayCommandV1): Promise<void> => {
    try {
      setError(null)
      setSnapshot(await window.rockfall.executeOverlayCommand(command))
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  const syncGameData = useCallback(async (): Promise<void> => {
    setError(null)
    setGameDataSyncing(true)
    try {
      const mining = await settleAction(() => window.rockfall.refreshMaterials())
      const blueprints = await settleAction(() => window.rockfall.getBlueprintCatalog(true))
      const factions = await settleAction(() => window.rockfall.getFactionCatalog(true))

      if (mining.status === 'fulfilled') setSnapshot(mining.value)
      setGameDataRevision((current) => current + 1)

      const failures = [
        mining.status === 'rejected' ? `Mining: ${getErrorMessage(mining.reason)}` : null,
        blueprints.status === 'rejected'
          ? `Blueprints: ${getErrorMessage(blueprints.reason)}`
          : null,
        factions.status === 'rejected' ? `Factions: ${getErrorMessage(factions.reason)}` : null
      ].filter((message): message is string => message !== null)

      if (failures.length > 0) {
        setError(`Game data sync failed. ${failures.join(' ')}`)
      }
    } finally {
      setGameDataSyncing(false)
    }
  }, [])

  const chooseGameData = useCallback(async (): Promise<boolean> => {
    try {
      setError(null)
      const result = await window.rockfall.chooseGameData()
      setSnapshot(result.snapshot)
      if (result.changed) setGameDataRevision((current) => current + 1)
      return result.changed
    } catch (reason) {
      setError(getErrorMessage(reason))
      return false
    }
  }, [])

  const getMiningLocations = useCallback(
    (materialId: string): Promise<MiningLocationResult> =>
      window.rockfall.getMiningLocations(materialId),
    []
  )

  const setShortcutCapture = useCallback(async (active: boolean): Promise<void> => {
    try {
      setError(null)
      setSnapshot(await window.rockfall.setShortcutCapture(active))
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  const runCloudAction = useCallback(
    async (action: () => Promise<CloudSyncState>): Promise<void> => {
      try {
        setError(null)
        const cloud = await action()
        setSnapshot((current) => (current ? { ...current, cloud } : current))
      } catch (reason) {
        setError(getErrorMessage(reason))
      }
    },
    []
  )

  const beginCloudLogin = useCallback(
    (): Promise<void> => runCloudAction(() => window.rockfall.beginCloudLogin()),
    [runCloudAction]
  )

  const completeCloudLogin = useCallback(
    (handoffCode: string): Promise<void> =>
      runCloudAction(() => window.rockfall.completeCloudLogin(handoffCode)),
    [runCloudAction]
  )

  const cancelCloudLogin = useCallback(
    (): Promise<void> => runCloudAction(() => window.rockfall.cancelCloudLogin()),
    [runCloudAction]
  )

  const syncCloud = useCallback(
    (): Promise<void> => runCloudAction(() => window.rockfall.syncCloud()),
    [runCloudAction]
  )

  const confirmCloudProfileImport = useCallback(
    (): Promise<void> => runCloudAction(() => window.rockfall.confirmCloudProfileImport()),
    [runCloudAction]
  )

  const logoutCloud = useCallback(
    (): Promise<void> => runCloudAction(() => window.rockfall.logoutCloud()),
    [runCloudAction]
  )

  const publishStaticData = useCallback(async (): Promise<void> => {
    try {
      setError(null)
      const staticData = await window.rockfall.publishStaticData()
      setSnapshot((current) => (current ? { ...current, staticData } : current))
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  const syncStarStrings = useCallback(async (): Promise<void> => {
    try {
      setError(null)
      const starStrings = await window.rockfall.syncStarStrings()
      setSnapshot((current) => (current ? { ...current, starStrings } : current))
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  useEffect(() => {
    const handleOnline = (): void => {
      void syncCloud()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [syncCloud])

  const checkForUpdates = useCallback(async (): Promise<void> => {
    try {
      setError(null)
      setSnapshot(await window.rockfall.checkForUpdates())
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  const restartToUpdate = useCallback(async (): Promise<void> => {
    try {
      setError(null)
      await window.rockfall.restartToUpdate()
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  const configureLanControl = useCallback(async (config: LanControlConfig): Promise<void> => {
    try {
      setError(null)
      setSnapshot(await window.rockfall.configureLanControl(config))
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  const beginLanPairing = useCallback(async (): Promise<LanPairingSession | null> => {
    try {
      setError(null)
      return await window.rockfall.beginLanPairing()
    } catch (reason) {
      setError(getErrorMessage(reason))
      return null
    }
  }, [])

  const cancelLanPairing = useCallback(async (): Promise<void> => {
    try {
      setError(null)
      setSnapshot(await window.rockfall.cancelLanPairing())
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  const revokeLanClient = useCallback(async (clientId: string): Promise<void> => {
    try {
      setError(null)
      setSnapshot(await window.rockfall.revokeLanClient(clientId))
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  const resetLanIdentity = useCallback(async (): Promise<void> => {
    try {
      setError(null)
      setSnapshot(await window.rockfall.resetLanIdentity())
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  return {
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
    checkForUpdates,
    restartToUpdate,
    configureLanControl,
    beginLanPairing,
    cancelLanPairing,
    revokeLanClient,
    resetLanIdentity
  }
}

function getErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function settleAction<T>(action: () => Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await action() }
  } catch (reason) {
    return { status: 'rejected', reason }
  }
}
