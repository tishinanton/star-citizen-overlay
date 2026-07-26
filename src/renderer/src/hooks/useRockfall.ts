import { useCallback, useEffect, useState } from 'react'

import type {
  AppSnapshot,
  MiningLocationResult,
  OverlaySettingsPatch
} from '../../../shared/contracts'

interface RockfallState {
  snapshot: AppSnapshot | null
  error: string | null
  updateSettings: (patch: OverlaySettingsPatch) => Promise<void>
  refreshMaterials: () => Promise<void>
  getMiningLocations: (materialId: string) => Promise<MiningLocationResult>
  setShortcutCapture: (active: boolean) => Promise<void>
  checkForUpdates: () => Promise<void>
  restartToUpdate: () => Promise<void>
}

export function useRockfall(): RockfallState {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    getMiningLocations,
    setShortcutCapture,
    checkForUpdates,
    restartToUpdate
  }
}

function getErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
