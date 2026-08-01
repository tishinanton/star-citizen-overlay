import { Fragment, useState } from 'react'
import { ChevronDown, MapPin, RefreshCw, Star, TriangleAlert } from 'lucide-react'

import type {
  MiningLocationRecommendation,
  MiningLocationResult,
  MiningLocationSourceState,
  MiningMaterial
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
  const [expandedQuantizationId, setExpandedQuantizationId] = useState<string | null>(null)
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
            Raw quality uses the game&apos;s 0–1000 scale. Find chance × quality chance = combined
            chance. Sites are ordered by combined chance.
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
                  <th scope="col">≥{activeThreshold} if found</th>
                  <th scope="col">Combined</th>
                  <th scope="col">Quality</th>
                  <th scope="col">Overlay</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location, index) => {
                  const isFavorite = favoriteLocationId === location.id
                  const isQuantizationExpanded = expandedQuantizationId === location.id
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
                          caption="if found"
                          title={`Conditional chance that at least one spawned ${material.name} reaches quantized quality ${activeThreshold} or higher.`}
                        />
                        <td
                          className={[
                            'mining-location-table__probability',
                            location.combinedProbability === null ? 'is-unavailable' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          title={`Combined chance: find ${material.name} and receive quantized quality ${activeThreshold} or higher.`}
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
                          <small>{formatMiningCompositionRange(location)} material</small>
                          {location.quantizationProbabilities.length > 0 ? (
                            <button
                              className="mining-location-table__quantization-toggle"
                              type="button"
                              aria-expanded={isQuantizationExpanded}
                              title="Conditional distribution of the best quantized result when independent spawn groups produce more than one rock."
                              onClick={() =>
                                setExpandedQuantizationId(
                                  isQuantizationExpanded ? null : location.id
                                )
                              }
                            >
                              {location.quantizationProbabilities.length} quantized values
                              <ChevronDown size={11} aria-hidden="true" />
                            </button>
                          ) : (
                            <small>No quantization data</small>
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
                      {isQuantizationExpanded && (
                        <tr className="mining-location-table__quantization-row">
                          <td colSpan={7}>
                            <div
                              className="mining-quantization-grid"
                              aria-label={`Best quantized quality distribution for ${location.name}`}
                            >
                              {location.quantizationProbabilities.map((quantization) => (
                                <span key={quantization.quality}>
                                  <strong>{quantization.quality}</strong>
                                  <small>{formatMiningProbability(quantization.probability)}</small>
                                </span>
                              ))}
                            </div>
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
