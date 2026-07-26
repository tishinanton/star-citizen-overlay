import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, RefreshCw, TriangleAlert, X } from 'lucide-react'

import type {
  MiningLocationRecommendation,
  MiningLocationResult,
  MiningMaterial
} from '../../../shared/contracts'
import { formatMiningProbability } from '../lib/mining-location-format'

const VIEWPORT_GUTTER = 12
const ANCHOR_GAP = 8
const FLYOUT_WIDTH = 410
const compositionFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1
})

interface MiningLocationFlyoutProps {
  anchor: HTMLButtonElement
  material: MiningMaterial
  loading: boolean
  result: MiningLocationResult | null
  error: string | null
  onClose: (restoreFocus: boolean) => void
  onRetry: () => void
}

interface FlyoutPosition {
  top: number
  left: number
}

export default function MiningLocationFlyout({
  anchor,
  material,
  loading,
  result,
  error,
  onClose,
  onRetry
}: MiningLocationFlyoutProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<FlyoutPosition>(() =>
    getInitialPosition(anchor.getBoundingClientRect())
  )

  useLayoutEffect(() => {
    const updatePosition = (): void => {
      const panel = panelRef.current
      if (!panel || !anchor.isConnected) return
      setPosition(getPosition(anchor.getBoundingClientRect(), panel.getBoundingClientRect()))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchor, error, loading, result])

  useEffect(() => {
    panelRef.current?.focus()
  }, [material.id])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (panelRef.current?.contains(event.target) || anchor.contains(event.target)) return
      onClose(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose(true)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchor, onClose])

  const locations = result?.locations ?? []
  const topProbability = locations[0]?.highQualityProbability ?? 1
  const style: CSSProperties = { top: position.top, left: position.left }

  return createPortal(
    <div
      ref={panelRef}
      id="mining-location-flyout"
      className="mining-location-flyout"
      role="dialog"
      aria-labelledby="mining-location-flyout-title"
      aria-describedby="mining-location-flyout-description"
      aria-busy={loading}
      tabIndex={-1}
      style={style}
    >
      <header className="mining-location-flyout__header">
        <span className="mining-location-flyout__icon" aria-hidden="true">
          <MapPin size={17} />
        </span>
        <div>
          <h2 id="mining-location-flyout-title">Best mining sites</h2>
          <p id="mining-location-flyout-description">
            {material.name} · ranked for a 50%+ quality find
          </p>
        </div>
        <button
          className="mining-location-flyout__close"
          type="button"
          aria-label="Close mining locations"
          onClick={() => onClose(true)}
        >
          <X size={15} />
        </button>
      </header>

      <div className="mining-location-flyout__body" aria-live="polite">
        {loading && <LocationSkeleton />}

        {!loading && error && (
          <div className="mining-location-flyout__state" role="alert">
            <TriangleAlert size={20} />
            <strong>Location data unavailable</strong>
            <span>{error}</span>
            <button type="button" onClick={onRetry}>
              <RefreshCw size={13} />
              Retry
            </button>
          </div>
        )}

        {!loading && !error && result && locations.length === 0 && (
          <div className="mining-location-flyout__state">
            <MapPin size={20} />
            <strong>No high-quality sites reported</strong>
            <span>The current game data has no qualifying 50%+ quality locations.</span>
          </div>
        )}

        {!loading && !error && locations.length > 0 && (
          <ol className="mining-location-list">
            {locations.map((location, index) => (
              <li key={location.id}>
                <span className="mining-location-list__rank" aria-label={`Rank ${index + 1}`}>
                  {index + 1}
                </span>
                <div className="mining-location-list__site">
                  <strong>{location.name}</strong>
                  {location.area && (
                    <span className="mining-location-list__area">
                      <MapPin size={10} />
                      {location.area}
                    </span>
                  )}
                  <small>{formatLocationContext(location)}</small>
                  <div className="mining-location-list__meter" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.max(
                          3,
                          (location.highQualityProbability / topProbability) * 100
                        )}%`
                      }}
                    />
                  </div>
                  <span className="mining-location-list__details">
                    Up to {Math.round(location.maxQuality / 10)}% quality
                    {location.maxComposition !== null
                      ? ` · ${compositionFormatter.format(location.maxComposition)}% material`
                      : ''}
                  </span>
                </div>
                <span className="mining-location-list__probability">
                  <strong>{formatMiningProbability(location.highQualityProbability)}</strong>
                  <small>high-grade</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {result && !loading && !error && (
        <footer className="mining-location-flyout__footer" title={result.message}>
          <span className={`mining-location-source mining-location-source--${result.state}`}>
            <span />
            {result.state === 'live' ? 'Live estimate' : 'Cached estimate'}
          </span>
          <span>spawn x deposit x quality roll</span>
        </footer>
      )}
    </div>,
    document.body
  )
}

function LocationSkeleton(): React.JSX.Element {
  return (
    <div className="mining-location-skeleton" aria-label="Loading mining locations">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index}>
          <i />
          <i />
          <i />
        </span>
      ))}
    </div>
  )
}

function formatLocationContext(location: MiningLocationRecommendation): string {
  const system = location.system.replace(/ System$/, '')
  const parent =
    location.parentName && location.parentName !== location.name && location.parentName !== system
      ? ` · ${location.parentName}`
      : ''
  return `${system} · ${location.type}${parent}`
}

function getInitialPosition(anchor: DOMRect): FlyoutPosition {
  const width = Math.min(FLYOUT_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2)
  return {
    top: Math.min(anchor.bottom + ANCHOR_GAP, window.innerHeight - VIEWPORT_GUTTER),
    left: Math.min(
      Math.max(VIEWPORT_GUTTER, anchor.right - width),
      window.innerWidth - width - VIEWPORT_GUTTER
    )
  }
}

function getPosition(anchor: DOMRect, panel: DOMRect): FlyoutPosition {
  const width = Math.min(panel.width, window.innerWidth - VIEWPORT_GUTTER * 2)
  const height = Math.min(panel.height, window.innerHeight - VIEWPORT_GUTTER * 2)
  const roomBelow = window.innerHeight - anchor.bottom - VIEWPORT_GUTTER
  const top =
    roomBelow >= height + ANCHOR_GAP
      ? anchor.bottom + ANCHOR_GAP
      : Math.max(VIEWPORT_GUTTER, anchor.top - height - ANCHOR_GAP)

  return {
    top,
    left: Math.min(
      Math.max(VIEWPORT_GUTTER, anchor.right - width),
      window.innerWidth - width - VIEWPORT_GUTTER
    )
  }
}
