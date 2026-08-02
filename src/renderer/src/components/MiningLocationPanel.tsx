import { useRef, useState } from 'react'
import { Layers3, MapPin, RefreshCw, Star, TriangleAlert } from 'lucide-react'

import type {
  MiningLocationRecommendation,
  MiningLocationResult,
  MiningLocationSourceState,
  MiningMaterial,
  MiningRockCompositionPart,
  MiningRockType
} from '../../../shared/contracts'
import {
  formatMiningCompositionRange,
  formatMiningProbability,
  formatMiningQualityRange
} from '../lib/mining-location-format'

const SOURCE_LABELS: Record<MiningLocationSourceState, string> = {
  game: 'Installed game data',
  'game-cached': 'Cached installed game data',
  live: 'Wiki fallback',
  cached: 'Cached Wiki fallback'
}

interface MiningLocationPanelProps {
  material: MiningMaterial | null
  loading: boolean
  result: MiningLocationResult | null
  error: string | null
  favoriteLocationId: string | null
  qualityThreshold: number
  onFavoriteChange: (locationId: string | null) => void
  onQualityThresholdChange: (qualityThreshold: number) => void
  onRetry: () => void
}

export default function MiningLocationPanel({
  material,
  loading,
  result,
  error,
  favoriteLocationId,
  qualityThreshold,
  onFavoriteChange,
  onQualityThresholdChange,
  onRetry
}: MiningLocationPanelProps): React.JSX.Element {
  const [selection, setSelection] = useState<{
    materialId: string | null
    locationId: string | null
    rockTypeId: string | null
  }>({ materialId: null, locationId: null, rockTypeId: null })
  const locations = result?.locations ?? []
  const selectedLocationId = selection.materialId === material?.id ? selection.locationId : null
  const preferredLocation =
    locations.find((location) => location.id === selectedLocationId) ??
    locations.find((location) => location.id === favoriteLocationId) ??
    locations[0] ??
    null
  const selectedRockTypeId =
    selection.materialId === material?.id && selection.locationId === preferredLocation?.id
      ? selection.rockTypeId
      : null
  const selectedRockType =
    preferredLocation?.rockTypes.find((rockType) => rockType.id === selectedRockTypeId) ??
    preferredLocation?.rockTypes[0] ??
    null
  const panelId = `mining-location-panel-${material?.id ?? 'empty'}`
  const compositionId = `${panelId}-composition`
  const activeThreshold = result?.qualityThreshold ?? qualityThreshold

  return (
    <>
      <section
        id={panelId}
        className="mining-pane mining-location-pane"
        aria-labelledby={`${panelId}-title`}
        aria-busy={loading}
      >
        <header className="mining-pane__header">
          <div className="mining-pane__identity">
            <span className="mining-pane__step" aria-hidden="true">
              2
            </span>
            <div>
              <h2 id={`${panelId}-title`}>Location</h2>
              <p>
                {material ? `Ranked sites for ${material.name}.` : 'Select an ore to view sites.'}
              </p>
            </div>
          </div>
          {result && !loading && !error && (
            <span className={`mining-location-source mining-location-source--${result.state}`}>
              <span aria-hidden="true" />
              {SOURCE_LABELS[result.state]}
            </span>
          )}
        </header>

        {material && (
          <QualityTarget
            key={`${material.id}-${qualityThreshold}`}
            panelId={panelId}
            qualityThreshold={qualityThreshold}
            onChange={onQualityThresholdChange}
          />
        )}

        <div className="mining-location-pane__body" aria-live="polite">
          {!material && (
            <MiningEmpty
              icon={<MapPin size={21} />}
              title="Choose an ore"
              message="Its ranked mining sites will appear here."
            />
          )}
          {material && loading && <LocationSkeleton />}
          {material && !loading && error && (
            <MiningEmpty
              alert
              icon={<TriangleAlert size={21} />}
              title="Location data unavailable"
              message={error}
              action={
                <button type="button" onClick={onRetry}>
                  <RefreshCw size={13} />
                  Retry
                </button>
              }
            />
          )}
          {material && !loading && !error && result && locations.length === 0 && (
            <MiningEmpty
              icon={<MapPin size={21} />}
              title="No mining sites reported"
              message="The current data source has no location records for this ore."
            />
          )}
          {material && !loading && !error && locations.length > 0 && (
            <div className="mining-location-list" role="list">
              {locations.map((location, index) => {
                const isSelected = preferredLocation?.id === location.id
                const isFavorite = favoriteLocationId === location.id
                return (
                  <article
                    className={[
                      'mining-location-row',
                      isSelected ? 'is-selected' : '',
                      isFavorite ? 'is-favorite' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    role="listitem"
                    key={location.id}
                  >
                    <button
                      className="mining-location-row__main"
                      type="button"
                      aria-current={isSelected ? 'true' : undefined}
                      aria-controls={compositionId}
                      onClick={() => {
                        setSelection({
                          materialId: material.id,
                          locationId: location.id,
                          rockTypeId: location.rockTypes[0]?.id ?? null
                        })
                      }}
                    >
                      <span className="mining-location-row__rank">{index + 1}</span>
                      <span className="mining-location-row__identity">
                        <span>
                          <strong>{location.name}</strong>
                          {location.identitySource === 'game-wiki' && (
                            <small
                              className="mining-location-row__identity-note"
                              title="Values are from installed game data; the Wiki supplied this location name."
                            >
                              name via Wiki
                            </small>
                          )}
                        </span>
                        <small>
                          {location.area ? `${location.area} · ` : ''}
                          {formatLocationContext(location)}
                        </small>
                      </span>
                      <span className="mining-location-row__combined">
                        <strong>
                          {location.combinedProbability === null
                            ? 'Unavailable'
                            : formatMiningProbability(location.combinedProbability)}
                        </strong>
                        <small>combined</small>
                      </span>
                      <span className="mining-location-row__metrics">
                        <span>
                          <small>Find rock</small>
                          <strong>
                            {location.rockSpawnProbability === null
                              ? 'Unavailable'
                              : formatMiningProbability(location.rockSpawnProbability)}
                          </strong>
                        </span>
                        <span>
                          <small>Entry ≥{activeThreshold}</small>
                          <strong>
                            {location.qualityThresholdProbability === null
                              ? 'Unavailable'
                              : formatMiningProbability(location.qualityThresholdProbability)}
                          </strong>
                        </span>
                        <span>
                          <small>Raw quality</small>
                          <strong>{formatMiningQualityRange(location)}</strong>
                        </span>
                        <span>
                          <small>Target share</small>
                          <strong>{formatMiningCompositionRange(location)}</strong>
                        </span>
                      </span>
                    </button>
                    <button
                      className={`mining-location-row__favorite ${isFavorite ? 'is-active' : ''}`}
                      type="button"
                      aria-pressed={isFavorite}
                      aria-label={`${isFavorite ? 'Clear' : 'Use'} ${location.name} as the overlay site`}
                      title={
                        isFavorite
                          ? 'Use the highest-ranked site in the overlay'
                          : `Use ${location.name} in the overlay`
                      }
                      onClick={() => onFavoriteChange(isFavorite ? null : location.id)}
                    >
                      <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
                      {isFavorite ? 'Using' : 'Use'}
                    </button>
                  </article>
                )
              })}
            </div>
          )}
        </div>

        {result && !loading && !error && (
          <footer className="mining-location-pane__footer" title={result.message}>
            <span>
              {locations.length} {locations.length === 1 ? 'site' : 'sites'}
            </span>
            <span>Quality target {activeThreshold}</span>
          </footer>
        )}
      </section>

      <section
        id={compositionId}
        className="mining-pane mining-composition-pane"
        aria-labelledby={`${compositionId}-title`}
        aria-busy={loading}
      >
        <header className="mining-pane__header">
          <div className="mining-pane__identity">
            <span className="mining-pane__step" aria-hidden="true">
              3
            </span>
            <div>
              <h2 id={`${compositionId}-title`}>Composition</h2>
              <p>
                {preferredLocation
                  ? `${preferredLocation.name} rock presets and entries.`
                  : 'Select a location to inspect its rocks.'}
              </p>
            </div>
          </div>
          {preferredLocation && (
            <span className="composition-preset-count">
              <strong>{preferredLocation.rockTypes.length}</strong>{' '}
              {preferredLocation.rockTypes.length === 1 ? 'preset' : 'presets'}
            </span>
          )}
        </header>

        <div className="mining-composition-pane__body" aria-live="polite">
          {!material && (
            <MiningEmpty
              icon={<Layers3 size={21} />}
              title="No ore selected"
              message="Choose an ore, then a mining site."
            />
          )}
          {material && loading && <CompositionSkeleton />}
          {material && !loading && error && (
            <MiningEmpty
              icon={<TriangleAlert size={21} />}
              title="Composition unavailable"
              message="Retry the location data to inspect rock presets."
            />
          )}
          {material && !loading && !error && result && !preferredLocation && (
            <MiningEmpty
              icon={<Layers3 size={21} />}
              title="No location selected"
              message="Choose a reported mining site to inspect its composition."
            />
          )}
          {preferredLocation && preferredLocation.rockTypes.length === 0 && (
            <MiningEmpty
              icon={<Layers3 size={21} />}
              title="Rock composition unavailable"
              message="This site has no reported rock presets."
            />
          )}
          {material && preferredLocation && selectedRockType && (
            <>
              <div className="mining-rock-tabs">
                <span>Rock preset</span>
                <div role="group" aria-label={`Rock presets at ${preferredLocation.name}`}>
                  {preferredLocation.rockTypes.map((rockType) => {
                    const isSelected = rockType.id === selectedRockType.id
                    return (
                      <button
                        key={rockType.id}
                        type="button"
                        className={isSelected ? 'is-active' : ''}
                        aria-pressed={isSelected}
                        title={`${rockType.name}, ${formatRockPresetMetadata(rockType)}`}
                        onClick={() =>
                          setSelection({
                            materialId: material.id,
                            locationId: preferredLocation.id,
                            rockTypeId: rockType.id
                          })
                        }
                      >
                        <strong>{rockType.name}</strong>
                        <small>{formatRockPresetMetadata(rockType)}</small>
                      </button>
                    )
                  })}
                </div>
              </div>

              {preferredLocation.quantizationProbabilities.length > 0 && (
                <section
                  className="mining-quality-outcomes"
                  aria-labelledby={`${compositionId}-quality-distribution-title`}
                >
                  <header className="mining-quality-outcomes__heading">
                    <strong id={`${compositionId}-quality-distribution-title`}>
                      Quality outcome distribution
                    </strong>
                    <small>
                      {preferredLocation.quantizationProbabilities.length} reported values
                    </small>
                  </header>
                  <QualityDistribution
                    outcomes={preferredLocation.quantizationProbabilities}
                    ariaLabel="Location quality probabilities"
                  />
                </section>
              )}

              <RockTypeRecord rockType={selectedRockType} />
            </>
          )}
        </div>
      </section>
    </>
  )
}

function QualityTarget({
  panelId,
  qualityThreshold,
  onChange
}: {
  panelId: string
  qualityThreshold: number
  onChange: (qualityThreshold: number) => void
}): React.JSX.Element {
  const [draftThreshold, setDraftThreshold] = useState(qualityThreshold)
  const lastAppliedThreshold = useRef(qualityThreshold)

  const applyDraftThreshold = (): void => {
    if (draftThreshold === lastAppliedThreshold.current) return
    lastAppliedThreshold.current = draftThreshold
    onChange(draftThreshold)
  }

  return (
    <div className="mining-quality-target">
      <label htmlFor={`${panelId}-quality-target`}>
        <span>
          Quality target
          <small>Raw game scale, 0-1000 · applies on release</small>
        </span>
        <input
          id={`${panelId}-quality-target`}
          type="range"
          min="0"
          max="1000"
          step="50"
          value={draftThreshold}
          onChange={(event) => setDraftThreshold(Number(event.target.value))}
          onKeyUp={applyDraftThreshold}
          onPointerUp={applyDraftThreshold}
        />
      </label>
      <div>
        <input
          type="number"
          min="0"
          max="1000"
          step="50"
          aria-label="Raw mining quality target"
          value={draftThreshold}
          onBlur={applyDraftThreshold}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value)) {
              setDraftThreshold(Math.min(1_000, Math.max(0, Math.round(value))))
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          onPointerUp={applyDraftThreshold}
        />
      </div>
    </div>
  )
}

function RockTypeRecord({ rockType }: { rockType: MiningRockType }): React.JSX.Element {
  return (
    <article className="mining-rock-detail">
      <div className="mining-composition-list">
        <div className="mining-composition-list__heading">
          <strong>Composition entries</strong>
          <span>
            {rockType.compositions.length}{' '}
            {rockType.compositions.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        {rockType.compositions.map((composition) => (
          <CompositionRecord key={composition.id} composition={composition} />
        ))}
      </div>
    </article>
  )
}

function CompositionRecord({
  composition
}: {
  composition: MiningRockCompositionPart
}): React.JSX.Element {
  return (
    <article className={`mining-composition-entry ${composition.isTarget ? 'is-target' : ''}`}>
      <header>
        <div>
          <strong>{composition.name}</strong>
          <span>
            {formatOptionalRange(composition.minPercentage, composition.maxPercentage, '%')} share
            {composition.isTarget ? ' · selected ore' : ''}
          </span>
        </div>
        {composition.probability !== null && (
          <span>{formatMiningProbability(composition.probability)} inclusion</span>
        )}
      </header>
      <dl className="mining-composition-entry__quality">
        <div>
          <dt>Quality outcomes</dt>
          <dd>
            <CompositionQualityOutcomes composition={composition} />
          </dd>
        </div>
      </dl>
    </article>
  )
}

function CompositionQualityOutcomes({
  composition
}: {
  composition: MiningRockCompositionPart
}): React.JSX.Element {
  const quantizationProbabilities = composition.quantizationProbabilities ?? []
  if (quantizationProbabilities.length > 0) {
    return (
      <QualityDistribution
        outcomes={quantizationProbabilities}
        ariaLabel={`${composition.name} quality probabilities`}
        compact
      />
    )
  }

  if (composition.quantizedValues.length > 0) {
    return (
      <span className="mining-quality-fallback">
        <strong>
          {composition.quantizedValues.map((value) => integerFormatter.format(value)).join(' · ')}
        </strong>
        <small>Probability unavailable</small>
      </span>
    )
  }

  return (
    <span className="mining-quality-fallback">
      <strong>{formatOptionalRange(composition.minQuality, composition.maxQuality)}</strong>
      <small>Quantization unavailable</small>
    </span>
  )
}

function QualityDistribution({
  outcomes,
  ariaLabel,
  compact = false
}: {
  outcomes: ReadonlyArray<{ quality: number; probability: number }>
  ariaLabel: string
  compact?: boolean
}): React.JSX.Element {
  return (
    <div
      className={`quality-distribution__scroll ${
        compact ? 'quality-distribution__scroll--entry' : ''
      }`}
    >
      <ol className="quality-distribution__plot" aria-label={ariaLabel}>
        {outcomes.map((outcome) => (
          <li
            key={outcome.quality}
            title={`Quality ${integerFormatter.format(
              outcome.quality
            )}: ${formatMiningProbability(outcome.probability)}`}
          >
            <strong>{integerFormatter.format(outcome.quality)}</strong>
            <span aria-hidden="true" />
            <small>{formatMiningProbability(outcome.probability)}</small>
          </li>
        ))}
      </ol>
    </div>
  )
}

function MiningEmpty({
  icon,
  title,
  message,
  action,
  alert = false
}: {
  icon: React.ReactNode
  title: string
  message: string
  action?: React.ReactNode
  alert?: boolean
}): React.JSX.Element {
  return (
    <div className="mining-empty" role={alert ? 'alert' : undefined}>
      {icon}
      <strong>{title}</strong>
      <span>{message}</span>
      {action}
    </div>
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
          <i />
        </span>
      ))}
    </div>
  )
}

function CompositionSkeleton(): React.JSX.Element {
  return (
    <div className="mining-composition-skeleton" aria-label="Loading rock composition">
      <span />
      <span />
      <span />
      <span />
    </div>
  )
}

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const qualityValueFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

function formatOptionalRange(minimum: number | null, maximum: number | null, suffix = ''): string {
  if (minimum === null && maximum === null) return 'Unavailable'
  if (minimum === null) return `Up to ${qualityValueFormatter.format(maximum ?? 0)}${suffix}`
  if (maximum === null) return `From ${qualityValueFormatter.format(minimum)}${suffix}`
  const min = qualityValueFormatter.format(minimum)
  const max = qualityValueFormatter.format(maximum)
  return min === max ? `${max}${suffix}` : `${min}–${max}${suffix}`
}

function formatClusterSize(minimum: number | null, maximum: number | null): string {
  if (minimum === null && maximum === null) return 'Cluster size unavailable'
  if (minimum === maximum) return `${integerFormatter.format(minimum ?? maximum ?? 0)} rocks`
  return `${integerFormatter.format(minimum ?? 0)}–${integerFormatter.format(
    maximum ?? minimum ?? 0
  )} rocks`
}

function formatRockPresetMetadata(rockType: MiningRockType): string {
  const entries = `${rockType.compositions.length} ${
    rockType.compositions.length === 1 ? 'entry' : 'entries'
  }`
  if (!rockType.cluster) return entries

  return `${entries} · cluster ${formatClusterSize(
    rockType.cluster.minSize,
    rockType.cluster.maxSize
  )}, ${formatMiningProbability(rockType.cluster.probability)} chance`
}

function formatLocationContext(location: MiningLocationRecommendation): string {
  const system = location.system.replace(/ System$/, '')
  const parent =
    location.parentName && location.parentName !== location.name && location.parentName !== system
      ? ` · ${location.parentName}`
      : ''
  return `${system} · ${location.type}${parent}`
}
