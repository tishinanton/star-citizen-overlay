import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Activity,
  Database,
  FolderOpen,
  Gauge,
  ListTree,
  Lock,
  MapPin,
  RefreshCw,
  Search,
  Shield,
  Target,
  TriangleAlert
} from 'lucide-react'

import type {
  FactionAlignment,
  FactionCatalogResult,
  FactionReputation,
  FactionReputationScope,
  FactionReputationStanding
} from '../../../shared/contracts'
import { useFactionCatalog } from '../hooks/useFactions'

type AlignmentFilter = 'all' | Exclude<FactionAlignment, 'unknown'>

const ALIGNMENT_FILTERS: Array<{ value: AlignmentFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'lawful', label: 'Lawful' },
  { value: 'unlawful', label: 'Unlawful' }
]

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2
})

export default function FactionBrowser(): React.JSX.Element {
  const catalog = useFactionCatalog()
  const [query, setQuery] = useState('')
  const [alignmentFilter, setAlignmentFilter] = useState<AlignmentFilter>('all')
  const [requestedFactionId, setRequestedFactionId] = useState<string | null>(null)

  const visibleFactions = useMemo(() => {
    if (!catalog.result) return []
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return catalog.result.factions.filter((faction) => {
      const matchesAlignment = alignmentFilter === 'all' || faction.alignment === alignmentFilter
      const matchesQuery =
        !normalizedQuery ||
        faction.name.toLocaleLowerCase().includes(normalizedQuery) ||
        faction.key.toLocaleLowerCase().includes(normalizedQuery) ||
        faction.description?.toLocaleLowerCase().includes(normalizedQuery) ||
        faction.headquarters?.toLocaleLowerCase().includes(normalizedQuery) ||
        faction.focus?.toLocaleLowerCase().includes(normalizedQuery) ||
        faction.scopes.some(
          (scope) =>
            scope.name.toLocaleLowerCase().includes(normalizedQuery) ||
            scope.standings.some((standing) =>
              standing.name.toLocaleLowerCase().includes(normalizedQuery)
            )
        )
      return matchesAlignment && Boolean(matchesQuery)
    })
  }, [alignmentFilter, catalog.result, query])

  const selectedFaction =
    visibleFactions.find((faction) => faction.id === requestedFactionId) ??
    visibleFactions[0] ??
    null
  const totalCount = catalog.result?.factions.length ?? 0
  const retainedCatalogError = catalog.result !== null && catalog.error !== null

  const handleFactionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number
  ): void => {
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? visibleFactions.length - 1
          : event.key === 'ArrowUp'
            ? Math.max(index - 1, 0)
            : event.key === 'ArrowDown'
              ? Math.min(index + 1, visibleFactions.length - 1)
              : null
    if (nextIndex === null || nextIndex === index) return

    event.preventDefault()
    const nextFaction = visibleFactions[nextIndex]
    setRequestedFactionId(nextFaction.id)
    requestAnimationFrame(() =>
      document.getElementById(`faction-option-${nextFaction.id}`)?.focus()
    )
  }

  const retryCatalog = (refresh = false): void => {
    document.getElementById('faction-directory-title')?.focus()
    void catalog.reload(refresh)
  }

  return (
    <main
      className="faction-workspace"
      id="panel-factions"
      role="tabpanel"
      aria-labelledby="tab-factions"
    >
      <section className="faction-directory" aria-labelledby="faction-directory-title">
        <div className="section-heading faction-directory__heading">
          <div>
            <span className="section-icon">
              <Shield size={17} />
            </span>
            <div>
              <h1 id="faction-directory-title" tabIndex={-1}>
                Faction directory
              </h1>
              <p>Compare every client-side reputation ladder and rank threshold.</p>
            </div>
          </div>
          <div className="faction-directory__status" aria-live="polite">
            {catalog.result && (
              <span
                className={`blueprint-source-state blueprint-source-state--${
                  retainedCatalogError ? 'cached' : catalog.result.state
                }`}
                title={catalog.result.message}
              >
                <span />
                {retainedCatalogError
                  ? 'Stale data'
                  : catalog.result.state === 'game'
                    ? 'Game data'
                    : 'Cached data'}
              </span>
            )}
            <strong>{numberFormatter.format(visibleFactions.length)}</strong>
            <span>of {numberFormatter.format(totalCount)}</span>
          </div>
        </div>

        <div className="faction-tools">
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search factions and reputation ranks</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search factions or ranks"
            />
          </label>
          <button
            className="icon-text-button"
            type="button"
            disabled={catalog.loading}
            onClick={() => void catalog.reload(true)}
          >
            <RefreshCw size={15} className={catalog.loading ? 'is-spinning' : ''} />
            Sync
          </button>
          <button
            className="icon-text-button"
            type="button"
            disabled={catalog.loading}
            onClick={() => void catalog.chooseGameData()}
          >
            <FolderOpen size={15} />
            Game files
          </button>
        </div>

        {retainedCatalogError && (
          <div className="faction-directory__warning" role="alert">
            <TriangleAlert size={14} />
            <span>
              <strong>Refresh failed; showing retained data</strong>
              <small>{catalog.error}</small>
            </span>
            <button type="button" onClick={() => retryCatalog(true)}>
              Retry
            </button>
          </div>
        )}

        <fieldset className="faction-filter-group" disabled={!catalog.result}>
          <legend>Alignment</legend>
          <div className="filter-strip" aria-label="Filter factions by alignment">
            {ALIGNMENT_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={alignmentFilter === filter.value ? 'is-active' : ''}
                aria-pressed={alignmentFilter === filter.value}
                onClick={() => setAlignmentFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="faction-list" aria-busy={catalog.loading && !catalog.result}>
          <div className="faction-list__header" aria-hidden="true">
            <span>Faction</span>
            <span>Alignment</span>
            <span>Reputation</span>
          </div>
          <div className="faction-list__body" role="listbox" aria-label="Factions">
            {!catalog.result && catalog.loading && <FactionListSkeleton />}

            {!catalog.result && catalog.error && (
              <div className="faction-empty" role="alert">
                <Database size={22} />
                <strong>Faction directory unavailable</strong>
                <span>{catalog.error}</span>
                <div>
                  <button type="button" onClick={() => retryCatalog()}>
                    Retry
                  </button>
                  <button type="button" onClick={() => void catalog.chooseGameData()}>
                    Choose Game files
                  </button>
                </div>
              </div>
            )}

            {catalog.result &&
              visibleFactions.map((faction, index) => {
                const selected = faction.id === selectedFaction?.id
                return (
                  <button
                    id={`faction-option-${faction.id}`}
                    className={`faction-row ${selected ? 'faction-row--selected' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    key={faction.id}
                    onClick={() => setRequestedFactionId(faction.id)}
                    onKeyDown={(event) => handleFactionKeyDown(event, index)}
                  >
                    <span className="faction-row__identity">
                      <strong>{faction.name}</strong>
                      <small>{faction.focus ?? faction.key}</small>
                    </span>
                    <AlignmentLabel alignment={faction.alignment} />
                    <span className="faction-row__reputation">
                      <strong>{faction.scopeCount}</strong>
                      <span>
                        {faction.scopeCount === 1 ? 'track' : 'tracks'} / {faction.standingCount}{' '}
                        ranks
                      </span>
                    </span>
                  </button>
                )
              })}

            {catalog.result && visibleFactions.length === 0 && (
              <div className="faction-empty">
                <Search size={22} />
                <strong>No matching factions</strong>
                <span>Try another faction, rank, headquarters, or alignment.</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="faction-detail" aria-labelledby="faction-detail-title">
        <div className="faction-detail__scroll">
          {!selectedFaction && catalog.loading && <FactionDetailSkeleton />}

          {!selectedFaction && !catalog.loading && (
            <div className="faction-detail__empty">
              <Shield size={30} />
              <strong>Select a faction</strong>
              <span>Reputation tracks and rank requirements will appear here.</span>
            </div>
          )}

          {selectedFaction && (
            <FactionDetailPane faction={selectedFaction} catalog={catalog.result} />
          )}
        </div>
      </aside>
    </main>
  )
}

function FactionDetailPane({
  faction,
  catalog
}: {
  faction: FactionReputation
  catalog: FactionCatalogResult | null
}): React.JSX.Element {
  return (
    <>
      <header className="faction-detail__header">
        <span className="faction-emblem" aria-hidden="true">
          {getFactionInitials(faction.name)}
        </span>
        <div className="faction-detail__identity">
          <AlignmentLabel alignment={faction.alignment} />
          <h2 id="faction-detail-title" tabIndex={-1}>
            {faction.name}
          </h2>
          <small>{faction.key}</small>
        </div>
      </header>

      <div className="faction-detail__body">
        <p className="faction-description">
          {faction.description ?? 'No public faction description is included in this game build.'}
        </p>

        <dl className="faction-facts">
          <div>
            <dt>
              <Shield size={13} />
              Alignment
            </dt>
            <dd>{alignmentLabel(faction.alignment)}</dd>
          </div>
          <div>
            <dt>
              <ListTree size={13} />
              Tracks
            </dt>
            <dd>{numberFormatter.format(faction.scopeCount)}</dd>
          </div>
          <div>
            <dt>
              <Gauge size={13} />
              Named ranks
            </dt>
            <dd>{numberFormatter.format(faction.standingCount)}</dd>
          </div>
          <div>
            <dt>
              <Database size={13} />
              Dataset
            </dt>
            <dd>{catalog?.state === 'cached' ? 'Cached game data' : 'Installed game data'}</dd>
          </div>
        </dl>

        {(faction.headquarters || faction.focus) && (
          <dl className="faction-profile">
            {faction.headquarters && (
              <div>
                <dt>
                  <MapPin size={13} />
                  Headquarters
                </dt>
                <dd>{faction.headquarters}</dd>
              </div>
            )}
            {faction.focus && (
              <div>
                <dt>
                  <Target size={13} />
                  Focus
                </dt>
                <dd>{faction.focus}</dd>
              </div>
            )}
          </dl>
        )}

        <section className="faction-requirements" aria-labelledby="faction-requirements-title">
          <div className="faction-requirements__heading">
            <div>
              <Activity size={15} />
              <h3 id="faction-requirements-title">Reputation requirements</h3>
            </div>
            <span>{catalog?.gameVersion ?? 'Installed build'}</span>
          </div>

          {faction.scopes.map((scope) => (
            <ReputationScopeTable key={scope.id} scope={scope} />
          ))}
        </section>
      </div>
    </>
  )
}

function ReputationScopeTable({ scope }: { scope: FactionReputationScope }): React.JSX.Element {
  return (
    <section className="reputation-scope" aria-labelledby={`scope-${scope.id}`}>
      <div className="reputation-scope__heading">
        <div>
          <h4 id={`scope-${scope.id}`}>{scope.name}</h4>
          {scope.description && <p>{scope.description}</p>}
        </div>
        <span>
          Starts {formatReputation(scope.initialReputation)}
          {scope.reputationCeiling > 0
            ? ` / ceiling ${formatReputation(scope.reputationCeiling)}`
            : ''}
        </span>
      </div>
      <div className="reputation-table-wrap">
        <table className="reputation-table">
          <thead>
            <tr>
              <th scope="col">Standing</th>
              <th scope="col">Minimum reputation</th>
              <th scope="col">Drift</th>
              <th scope="col">Access</th>
            </tr>
          </thead>
          <tbody>
            {scope.standings.map((standing) => (
              <ReputationStandingRow key={standing.id} standing={standing} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ReputationStandingRow({
  standing
}: {
  standing: FactionReputationStanding
}): React.JSX.Element {
  return (
    <tr>
      <th scope="row">
        <strong>{standing.name}</strong>
        {standing.perkDescription && <small>{standing.perkDescription}</small>}
      </th>
      <td className="reputation-table__number">{formatReputation(standing.minReputation)}</td>
      <td>{formatDrift(standing)}</td>
      <td>
        {standing.gated ? (
          <span className="reputation-gate" title="The game data marks this standing as gated">
            <Lock size={12} />
            Gated
          </span>
        ) : (
          <span className="reputation-open">Open</span>
        )}
      </td>
    </tr>
  )
}

function AlignmentLabel({ alignment }: { alignment: FactionAlignment }): React.JSX.Element {
  return (
    <span className={`faction-alignment faction-alignment--${alignment}`}>
      <span />
      {alignmentLabel(alignment)}
    </span>
  )
}

function alignmentLabel(alignment: FactionAlignment): string {
  return alignment === 'lawful' ? 'Lawful' : alignment === 'unlawful' ? 'Unlawful' : 'Unknown'
}

function formatReputation(value: number): string {
  return numberFormatter.format(value)
}

function formatDrift(standing: FactionReputationStanding): string {
  if (standing.driftReputation === 0 || standing.driftTimeHours === 0) return 'None'
  const amount =
    standing.driftReputation > 0
      ? `+${formatReputation(standing.driftReputation)}`
      : formatReputation(standing.driftReputation)
  return `${amount} / ${formatHours(standing.driftTimeHours)}`
}

function formatHours(hours: number): string {
  if (hours === 1) return '1 hour'
  return `${numberFormatter.format(hours)} hours`
}

function getFactionInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase())
    .join('')
}

function FactionListSkeleton(): React.JSX.Element {
  return (
    <div className="faction-list-skeleton" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}

function FactionDetailSkeleton(): React.JSX.Element {
  return (
    <div className="faction-detail-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  )
}
