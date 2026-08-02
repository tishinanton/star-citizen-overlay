import { useCallback, useEffect, useRef, useState } from 'react'

import type { FactionCatalogResult } from '../../../shared/contracts'

interface FactionCatalogState {
  result: FactionCatalogResult | null
  loading: boolean
  error: string | null
  reload: (refresh?: boolean) => Promise<void>
}

export function useFactionCatalog(gameDataRevision = 0): FactionCatalogState {
  const [result, setResult] = useState<FactionCatalogResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const reload = useCallback(async (refresh = false): Promise<void> => {
    const requestGeneration = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const nextResult = await window.rockfall.getFactionCatalog(refresh)
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
      .getFactionCatalog()
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

function getErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
