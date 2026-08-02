import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  BlueprintCatalogResult,
  BlueprintDetailResult,
  BlueprintOwnershipSnapshot
} from '../../../shared/contracts'

const DETAIL_SELECTION_DELAY_MS = 120

interface BlueprintCatalogState {
  result: BlueprintCatalogResult | null
  loading: boolean
  error: string | null
  reload: (refresh?: boolean) => Promise<void>
}

interface BlueprintDetailState {
  result: BlueprintDetailResult | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

interface BlueprintOwnershipState {
  result: BlueprintOwnershipSnapshot | null
  loading: boolean
  error: string | null
  updatingBlueprintId: string | null
  reload: () => Promise<void>
  retry: () => Promise<void>
  rescan: () => Promise<void>
  setOwned: (blueprintId: string, owned: boolean) => Promise<void>
}

type BlueprintOwnershipFailedAction =
  | { type: 'reload' }
  | { type: 'rescan' }
  | { type: 'set-owned'; blueprintId: string; owned: boolean }

interface BlueprintDetailError {
  requestKey: string
  message: string
}

interface BlueprintDetailSuccess {
  requestKey: string
  result: BlueprintDetailResult
}

export function useBlueprintCatalog(gameDataRevision = 0): BlueprintCatalogState {
  const [result, setResult] = useState<BlueprintCatalogResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const reload = useCallback(async (refresh = false): Promise<void> => {
    const requestGeneration = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const nextResult = await window.rockfall.getBlueprintCatalog(refresh)
      if (generation.current === requestGeneration) setResult(nextResult)
    } catch (reason) {
      if (generation.current === requestGeneration) setError(getErrorMessage(reason))
    } finally {
      if (generation.current === requestGeneration) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const requestGeneration = ++generation.current
    window.rockfall
      .getBlueprintCatalog()
      .then((nextResult) => {
        if (generation.current === requestGeneration) {
          setResult(nextResult)
          setError(null)
        }
      })
      .catch((reason: unknown) => {
        if (generation.current === requestGeneration) setError(getErrorMessage(reason))
      })
      .finally(() => {
        if (generation.current === requestGeneration) setLoading(false)
      })

    return () => {
      generation.current += 1
    }
  }, [gameDataRevision])

  return { result, loading, error, reload }
}

export function useBlueprintDetail(
  blueprintId: string | null,
  catalogUpdatedAt: string | null,
  catalogState: BlueprintCatalogResult['state'] | null
): BlueprintDetailState {
  const requestKey = blueprintId
    ? `${blueprintId}:${catalogUpdatedAt ?? 'initial'}:${catalogState ?? 'loading'}`
    : ''
  const [success, setSuccess] = useState<BlueprintDetailSuccess | null>(null)
  const [error, setError] = useState<BlueprintDetailError | null>(null)
  const generation = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    if (!blueprintId) return

    const requestGeneration = ++generation.current
    setSuccess(null)
    setError(null)
    try {
      const nextResult = await window.rockfall.getBlueprintDetail(blueprintId)
      if (generation.current === requestGeneration) {
        setSuccess({ requestKey, result: nextResult })
      }
    } catch (reason) {
      if (generation.current === requestGeneration) {
        setError({ requestKey, message: getErrorMessage(reason) })
      }
    }
  }, [blueprintId, requestKey])

  useEffect(() => {
    if (!blueprintId) return

    const requestGeneration = ++generation.current
    const timer = window.setTimeout(() => {
      window.rockfall
        .getBlueprintDetail(blueprintId)
        .then((nextResult) => {
          if (generation.current === requestGeneration) {
            setSuccess({ requestKey, result: nextResult })
          }
        })
        .catch((reason: unknown) => {
          if (generation.current === requestGeneration) {
            setError({ requestKey, message: getErrorMessage(reason) })
          }
        })
    }, DETAIL_SELECTION_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
      generation.current += 1
    }
  }, [blueprintId, requestKey])

  const currentResult = success?.requestKey === requestKey ? success.result : null
  const currentError = error?.requestKey === requestKey ? error.message : null
  return {
    result: currentResult,
    loading: blueprintId !== null && currentResult === null && currentError === null,
    error: currentError,
    reload
  }
}

export function useBlueprintOwnership(): BlueprintOwnershipState {
  const [result, setResult] = useState<BlueprintOwnershipSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingBlueprintId, setUpdatingBlueprintId] = useState<string | null>(null)
  const [failedAction, setFailedAction] = useState<BlueprintOwnershipFailedAction | null>(null)
  const generation = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    const requestGeneration = ++generation.current
    setLoading(true)
    setError(null)
    setFailedAction(null)
    try {
      const nextResult = await window.rockfall.getBlueprintOwnership()
      if (generation.current === requestGeneration) setResult(nextResult)
    } catch (reason) {
      if (generation.current === requestGeneration) {
        setError(getErrorMessage(reason))
        setFailedAction({ type: 'reload' })
      }
    } finally {
      if (generation.current === requestGeneration) setLoading(false)
    }
  }, [])

  const rescan = useCallback(async (): Promise<void> => {
    setError(null)
    setFailedAction(null)
    try {
      setResult(await window.rockfall.rescanBlueprintOwnership())
    } catch (reason) {
      setError(getErrorMessage(reason))
      setFailedAction({ type: 'rescan' })
    }
  }, [])

  const setOwned = useCallback(async (blueprintId: string, owned: boolean): Promise<void> => {
    setUpdatingBlueprintId(blueprintId)
    setError(null)
    setFailedAction(null)
    try {
      setResult(await window.rockfall.setBlueprintOwned(blueprintId, owned))
    } catch (reason) {
      setError(getErrorMessage(reason))
      setFailedAction({ type: 'set-owned', blueprintId, owned })
    } finally {
      setUpdatingBlueprintId((current) => (current === blueprintId ? null : current))
    }
  }, [])

  const retry = useCallback(async (): Promise<void> => {
    const action = failedAction
    if (!action) return
    if (action.type === 'set-owned') setUpdatingBlueprintId(action.blueprintId)
    setError(null)
    try {
      const nextResult =
        action.type === 'reload'
          ? await window.rockfall.getBlueprintOwnership()
          : action.type === 'rescan'
            ? await window.rockfall.rescanBlueprintOwnership()
            : await window.rockfall.setBlueprintOwned(action.blueprintId, action.owned)
      setResult(nextResult)
      setFailedAction(null)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      if (action.type === 'set-owned') {
        setUpdatingBlueprintId((current) => (current === action.blueprintId ? null : current))
      }
    }
  }, [failedAction])

  useEffect(() => {
    const requestGeneration = ++generation.current
    const unsubscribe = window.rockfall.onBlueprintOwnership((nextResult) => {
      generation.current += 1
      setResult(nextResult)
      setLoading(false)
    })
    window.rockfall
      .getBlueprintOwnership()
      .then((nextResult) => {
        if (generation.current === requestGeneration) setResult(nextResult)
      })
      .catch((reason: unknown) => {
        if (generation.current === requestGeneration) {
          setError(getErrorMessage(reason))
          setFailedAction({ type: 'reload' })
        }
      })
      .finally(() => {
        if (generation.current === requestGeneration) setLoading(false)
      })

    return () => {
      generation.current += 1
      unsubscribe()
    }
  }, [])

  return { result, loading, error, updatingBlueprintId, reload, retry, rescan, setOwned }
}

function getErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
