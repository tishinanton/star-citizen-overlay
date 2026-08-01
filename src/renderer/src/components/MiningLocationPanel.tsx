import { Fragment, useState } from 'react'
import { ChevronDown, Layers3, MapPin, RefreshCw, Star, TriangleAlert } from 'lucide-react'

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
  material: MiningMaterial
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
  const [draftThreshold, setDraftThreshold] = useState(qualityThreshold)
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null)
  const locations = result?.locations ?? []
  const topProbability =
    locations.find(
      (location) => location.combinedProbability !== null && location.combinedProbability > 0
    )?.combinedProbability ?? 0
  const panelId = `mining-location-panel-${material.id}`
  const titleId = `${panelId}-title`
  const activeThreshold = result?.qualityThreshold ?? qualityThreshold

  return (
    <section
      id={panelId}
      className="mining-location-panel"
      aria-labelledby={titleId}
      aria-busy={loading}
    >
      <header className="mining-location-panel__header">
        <span className="mining-location-panel__icon" aria-hidden="true">
          <MapPin size={17} />
        </span>
        <div>
          <h2 id={titleId}>All {material.name} mining sites</h2>
          <p>
            Sites are ordered by the chance to find a rock with any {material.name} composition
            entry at or above the target. Expand a site to inspect its rock presets and slots.
          </p>
        </div>
        <div className="mining-quality-target">
          <label htmlFor={`${panelId}-quality-target`}>
            Quality target
            <input
              id={`${panelId}-quality-target`}
              type="range"
              min="0"
              max="1000"
              step="1"
              value={draftThreshold}
              onChange={(event) => setDraftThreshold(Number(event.target.value))}
            />
          </label>
          <div>
            <input
              type="number"
              min="0"
              max="1000"
              step="1"
              aria-label="Raw mining quality target"
              value={draftThreshold}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (Number.isFinite(value)) {
                  setDraftThreshold(Math.min(1_000, Math.max(0, Math.round(value))))
                }
              }}
            />
            <button
              type="button"
              disabled={loading || draftThreshold === qualityThreshold}
              onClick={() => onQualityThresholdChange(draftThreshold)}
            >
              Apply
            </button>
          </div>
        </div>
      </header>

      <div className="mining-location-panel__body" aria-live="polite">
        {loading && <LocationSkeleton />}

        {!loading && error && (
          <div className="mining-location-panel__state" role="alert">
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
          <div className="mining-location-panel__state">
            <MapPin size={20} />
            <strong>No mining sites reported</strong>
            <span>The current data source has no location records for this material.</span>
          </div>
        )}

        {!loading && !error && locations.length > 0 && (
          <div className="mining-location-table-wrap">
            <table className="mining-location-table">
              <thead>
                <tr>
                  <th scope="col" aria-label="Rank">
                    #
                  </th>
                  <th scope="col">Site</th>
                  <th scope="col">Find rock</th>
                  <th scope="col">Any entry ≥{activeThreshold}</th>
                  <th scope="col">Combined</th>
                  <th scope="col">Quality</th>
                  <th scope="col">Overlay</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location, index) => {
                  const isFavorite = favoriteLocationId === location.id
                  const isLocationExpanded = expandedLocationId === location.id
                  const rockDetailsId = `${panelId}-rocks-${index}`
                  return (
                    <Fragment key={location.id}>
                      <tr
                        className={[index === 0 ? 'is-best' : '', isFavorite ? 'is-favorite' : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <td className="mining-location-table__rank">
                          <span aria-label={`Rank ${index + 1}`}>{index + 1}</span>
                        </td>
                        <th className="mining-location-table__site" scope="row">
                          <span className="mining-location-table__site-name">
                            <strong>{location.name}</strong>
                            {location.area && (
                              <span>
                                <MapPin size={10} />
                                {location.area}
                              </span>
                            )}
                            {location.identitySource === 'game-wiki' && (
                              <span
                                className="mining-location-table__identity-note"
                                title="Site values are from installed game data; the Star Citizen Wiki supplied only this location's name because the game archive could not tie this provider to a single named location."
                              >
                                name via Wiki
                              </span>
                            )}
                          </span>
                          <small>{formatLocationContext(location)}</small>
                        </th>
                        <ProbabilityCell
                          className="mining-location-table__rock-probability"
                          value={location.rockSpawnProbability}
                          caption="per spawn"
                          title={`Estimated chance that a mining spawn at ${location.name} selects ${material.name}.`}
                        />
                        <ProbabilityCell
                          className="mining-location-table__quality-probability"
                          value={location.qualityThresholdProbability}
                          caption="among entries"
                          title={`Conditional chance that at least one ${material.name} composition entry in a found rock reaches quantized quality ${activeThreshold} or higher.`}
                        />
                        <td
                          className={[
                            'mining-location-table__probability',
                            location.combinedProbability === null ? 'is-unavailable' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          title={`Combined chance: find a rock containing ${material.name} with at least one composition entry at quantized quality ${activeThreshold} or higher.`}
                        >
                          <strong>
                            {location.combinedProbability === null
                              ? 'Unavailable'
                              : formatMiningProbability(location.combinedProbability)}
                          </strong>
                          <small>both</small>
                          {location.combinedProbability !== null && (
                            <span className="mining-location-table__meter" aria-hidden="true">
                              <span
                                style={{
                                  width:
                                    topProbability > 0
                                      ? `${Math.max(
                                          location.combinedProbability > 0 ? 3 : 0,
                                          (location.combinedProbability / topProbability) * 100
                                        )}%`
                                      : '0%'
                                }}
                              />
                            </span>
                          )}
                        </td>
                        <td className="mining-location-table__yield">
                          <strong>{formatMiningQualityRange(location)}</strong>
                          <small>{formatMiningCompositionRange(location)} target share</small>
                          {location.rockTypes.length > 0 ? (
                            <button
                              className="mining-location-table__rock-toggle"
                              type="button"
                              aria-expanded={isLocationExpanded}
                              aria-controls={rockDetailsId}
                              aria-label={`Inspect ${location.rockTypes.length} ${location.rockTypes.length === 1 ? 'rock preset' : 'rock presets'} at ${location.name}`}
                              title={`Inspect every rock preset and composition entry for ${location.name}.`}
                              onClick={() =>
                                setExpandedLocationId(isLocationExpanded ? null : location.id)
                              }
                            >
                              <Layers3 size={11} aria-hidden="true" />
                              {location.rockTypes.length}{' '}
                              {location.rockTypes.length === 1 ? 'rock preset' : 'rock presets'}
                              <ChevronDown size={11} aria-hidden="true" />
                            </button>
                          ) : (
                            <small>Rock composition unavailable</small>
                          )}
                        </td>
                        <td className="mining-location-table__favorite">
                          <button
                            className={isFavorite ? 'is-active' : ''}
                            type="button"
                            aria-pressed={isFavorite}
                            aria-label={`${isFavorite ? 'Remove' : 'Set'} ${location.name} as the favorite mining site for ${material.name}`}
                            title={
                              isFavorite
                                ? 'Use the highest-ranked site in the overlay'
                                : 'Use this site in the overlay'
                            }
                            onClick={() => onFavoriteChange(isFavorite ? null : location.id)}
                          >
                            <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
                            {isFavorite ? 'Using' : 'Use'}
                          </button>
                        </td>
                      </tr>
                      {isLocationExpanded && (
                        <tr className="mining-location-table__rock-row">
                          <td colSpan={7}>
                            <RockTypeDrilldown
                              id={rockDetailsId}
                              location={location}
                              materialName={material.name}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {result && !loading && !error && (
        <footer className="mining-location-panel__footer" title={result.message}>
          <span className={`mining-location-source mining-location-source--${result.state}`}>
            <span />
            {SOURCE_LABELS[result.state]}
          </span>
          <span>
            {locations.length} reported {locations.length === 1 ? 'site' : 'sites'} · static game
            rules · quality target {activeThreshold}
          </span>
        </footer>
      )}
    </section>
  )
}

function RockTypeDrilldown({
  id,
  location,
  materialName
}: {
  id: string
  location: MiningLocationRecommendation
  materialName: string
}): React.JSX.Element {
  const targetEntryCount = location.rockTypes.reduce(
    (count, rockType) =>
      count + rockType.compositions.filter((composition) => composition.isTarget).length,
    0
  )
  return (
    <section id={id} className="mining-rock-browser" aria-label={`${location.name} rock presets`}>
      <header className="mining-rock-browser__header">
        <span>
          <Layers3 size={14} aria-hidden="true" />
          <strong>
            {location.rockTypes.length}{' '}
            {location.rockTypes.length === 1 ? 'rock preset' : 'rock presets'} at {location.name}
          </strong>
        </span>
        <small>
          {targetEntryCount} {materialName}{' '}
          {targetEntryCount === 1 ? 'composition entry' : 'composition entries'}
        </small>
      </header>
      <div className="mining-rock-browser__list">
        {location.rockTypes.map((rockType) => (
          <RockTypeRecord key={rockType.id} rockType={rockType} />
        ))}
      </div>
    </section>
  )
}

function RockTypeRecord({ rockType }: { rockType: MiningRockType }): React.JSX.Element {
  return (
    <article className="mining-rock-type">
      <header className="mining-rock-type__header">
        <div>
          <h3>{rockType.name}</h3>
          <code>{rockType.key}</code>
        </div>
        <div className="mining-rock-type__facts">
          <span>
            {rockType.compositions.length} composition{' '}
            {rockType.compositions.length === 1 ? 'slot' : 'slots'}
            {rockType.minimumCompositionCount !== null
              ? ` · minimum ${rockType.minimumCompositionCount}`
              : ''}
          </span>
          {rockType.signature !== null && (
            <span>Signature {integerFormatter.format(rockType.signature)}</span>
          )}
          {rockType.groupProbability !== null && (
            <span>Group roll {formatMiningProbability(rockType.groupProbability)}</span>
          )}
          {rockType.relativeProbability !== null && (
            <span>{formatMiningProbability(rockType.relativeProbability)} within group</span>
          )}
          {rockType.cluster && (
            <span>
              {formatClusterSize(rockType.cluster.minSize, rockType.cluster.maxSize)} ·{' '}
              {formatMiningProbability(rockType.cluster.probability)} clustered
            </span>
          )}
        </div>
      </header>
      <div className="mining-rock-composition-wrap">
        <table className="mining-rock-composition-table">
          <thead>
            <tr>
              <th scope="col">Composition entry</th>
              <th scope="col">Share</th>
              <th scope="col">Raw quality</th>
              <th scope="col">Scale</th>
              <th scope="col">Quantized outputs</th>
            </tr>
          </thead>
          <tbody>
            {rockType.compositions.map((composition, index) => (
              <CompositionRow
                key={composition.id}
                composition={composition}
                slotNumber={index + 1}
              />
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}

function CompositionRow({
  composition,
  slotNumber
}: {
  composition: MiningRockCompositionPart
  slotNumber: number
}): React.JSX.Element {
  return (
    <tr className={composition.isTarget ? 'is-target' : ''}>
      <th scope="row">
        <span>{composition.name}</span>
        <small>
          Slot {slotNumber}
          {composition.isTarget ? ' · selected ore' : ''}
          {composition.probability !== null
            ? ` · ${formatMiningProbability(composition.probability)} inclusion`
            : ''}
        </small>
      </th>
      <td>{formatOptionalRange(composition.minPercentage, composition.maxPercentage, '%')}</td>
      <td>
        <span>{formatOptionalRange(composition.minQuality, composition.maxQuality)}</span>
        {(composition.meanQuality !== null || composition.qualityStdDev !== null) && (
          <small>
            μ {formatOptionalNumber(composition.meanQuality)} · σ{' '}
            {formatOptionalNumber(composition.qualityStdDev)}
          </small>
        )}
      </td>
      <td>
        <span>
          {composition.qualityScale === null
            ? 'Unavailable'
            : `×${qualityValueFormatter.format(composition.qualityScale)}`}
        </span>
        {composition.curveExponent !== null && (
          <small>curve ×{qualityValueFormatter.format(composition.curveExponent)}</small>
        )}
      </td>
      <td>
        {composition.quantizedValues.length > 0
          ? composition.quantizedValues.map((value) => integerFormatter.format(value)).join(' · ')
          : 'Unavailable'}
      </td>
    </tr>
  )
}

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const qualityValueFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

function formatOptionalNumber(value: number | null): string {
  return value === null ? '—' : qualityValueFormatter.format(value)
}

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
  return `${integerFormatter.format(minimum ?? 0)}–${integerFormatter.format(maximum ?? minimum ?? 0)} rocks`
}

function ProbabilityCell({
  className,
  value,
  caption,
  title
}: {
  className: string
  value: number | null
  caption: string
  title: string
}): React.JSX.Element {
  return (
    <td
      className={[
        className,
        'mining-location-table__probability',
        value === null ? 'is-unavailable' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      title={title}
    >
      <strong>{value === null ? 'Unavailable' : formatMiningProbability(value)}</strong>
      <small>{value === null ? 'incomplete' : caption}</small>
    </td>
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
