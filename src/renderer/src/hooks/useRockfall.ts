import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_APP_FONT_SIZE,
  type AppSnapshot,
  type CloudSyncState,
  type MiningLocationResult,
  type OverlaySettingsPatch
} from '../../../shared/contracts'

interface RockfallState {
  snapshot: AppSnapshot | null
  error: string | null
  updateSettings: (patch: OverlaySettingsPatch) => Promise<void>
  refreshMaterials: () => Promise<void>
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
  checkForUpdates: () => Promise<void>
  restartToUpdate: () => Promise<void>
}

export function useRockfall(): RockfallState {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const refreshMaterials = useCallback(async (): Promise<void> => {
    try {
      setError(null)
      setSnapshot(await window.rockfall.refreshMaterials())
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }, [])

  const chooseGameData = useCallback(async (): Promise<boolean> => {
    try {
      setError(null)
      const result = await window.rockfall.chooseGameData()
      setSnapshot(result.snapshot)
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

  return {
    snapshot,
    error,
    updateSettings,
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
    checkForUpdates,
    restartToUpdate
  }
}

function getErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
