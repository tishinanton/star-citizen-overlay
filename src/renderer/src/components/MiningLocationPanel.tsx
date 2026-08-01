import { MapPin, RefreshCw, Star, TriangleAlert } from 'lucide-react'

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
  onFavoriteChange: (locationId: string | null) => void
  onRetry: () => void
}

export default function MiningLocationPanel({
  material,
  loading,
  result,
  error,
  favoriteLocationId,
  onFavoriteChange,
  onRetry
}: MiningLocationPanelProps): React.JSX.Element {
  const locations = result?.locations ?? []
  const topProbability =
    locations.find(
      (location) => location.highQualityProbability !== null && location.highQualityProbability > 0
    )?.highQualityProbability ?? 0
  const panelId = `mining-location-panel-${material.id}`
  const titleId = `${panelId}-title`

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
            Site chance = spawn group × relative deposit × quality-roll chance. Composition (the
            material&apos;s share of the deposit) is separate. Star one site to use it in the
            overlay.
          </p>
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
                  <th scope="col">50%+ chance</th>
                  <th scope="col">Quality range</th>
                  <th scope="col">Overlay</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location, index) => {
                  const isFavorite = favoriteLocationId === location.id
                  return (
                    <tr
                      className={[index === 0 ? 'is-best' : '', isFavorite ? 'is-favorite' : '']
                        .filter(Boolean)
                        .join(' ')}
                      key={location.id}
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
                      <td
                        className={[
                          'mining-location-table__probability',
                          location.highQualityProbability === null ? 'is-unavailable' : ''
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={`Estimated chance of finding ${material.name} at 50% or higher quality. Combines spawn group, relative deposit, and quality distribution data.`}
                      >
                        <strong>
                          {location.highQualityProbability === null
                            ? 'Unavailable'
                            : formatMiningProbability(location.highQualityProbability)}
                        </strong>
                        <small>
                          {location.highQualityProbability === null ? 'incomplete' : 'estimated'}
                        </small>
                        {location.highQualityProbability !== null && (
                          <span className="mining-location-table__meter" aria-hidden="true">
                            <span
                              style={{
                                width:
                                  topProbability > 0
                                    ? `${Math.max(
                                        location.highQualityProbability > 0 ? 3 : 0,
                                        (location.highQualityProbability / topProbability) * 100
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
            rules, not live telemetry
          </span>
        </footer>
      )}
    </section>
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
