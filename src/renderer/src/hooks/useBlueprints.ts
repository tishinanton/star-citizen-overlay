import { useCallback, useEffect, useRef, useState } from 'react'

import type { BlueprintCatalogResult, BlueprintDetailResult } from '../../../shared/contracts'

const DETAIL_SELECTION_DELAY_MS = 120

interface BlueprintCatalogState {
  result: BlueprintCatalogResult | null
  loading: boolean
  error: string | null
  reload: (refresh?: boolean) => Promise<void>
  chooseGameData: () => Promise<void>
}

interface BlueprintDetailState {
  result: BlueprintDetailResult | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

interface BlueprintDetailError {
  requestKey: string
  message: string
}

interface BlueprintDetailSuccess {
  requestKey: string
  result: BlueprintDetailResult
}

export function useBlueprintCatalog(): BlueprintCatalogState {
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

  const chooseGameData = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const selection = await window.rockfall.chooseGameData()
      if (!selection.changed) {
        setLoading(false)
        return
      }
    } catch (reason) {
      setError(getErrorMessage(reason))
      setLoading(false)
      return
    }
    await reload(true)
  }, [reload])

  useEffect(() => {
    const requestGeneration = ++generation.current
    window.rockfall
      .getBlueprintCatalog()
      .then((nextResult) => {
        if (generation.current === requestGeneration) setResult(nextResult)
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
  }, [])

  return { result, loading, error, reload, chooseGameData }
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

function getErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
