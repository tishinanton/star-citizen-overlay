import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Box,
  Clock3,
  Database,
  ExternalLink,
  FolderOpen,
  Hammer,
  Lock,
  PackageOpen,
  RefreshCw,
  Route,
  Search,
  TriangleAlert,
  Unlock
} from 'lucide-react'

import type {
  BlueprintDetail,
  BlueprintIngredient,
  BlueprintRequirementGroup,
  BlueprintSummary
} from '../../../shared/contracts'
import { useBlueprintCatalog, useBlueprintDetail } from '../hooks/useBlueprints'

type BlueprintAccessFilter = 'all' | 'mission' | 'default'

const ACCESS_FILTERS: Array<{ value: BlueprintAccessFilter; label: string }> = [
  { value: 'all', label: 'All blueprints' },
  { value: 'mission', label: 'Mission unlock' },
  { value: 'default', label: 'Available by default' }
]

const quantityFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 3
})
const countFormatter = new Intl.NumberFormat('en-US')

export default function BlueprintBrowser(): React.JSX.Element {
  const catalog = useBlueprintCatalog()
  const [query, setQuery] = useState('')
  const [accessFilter, setAccessFilter] = useState<BlueprintAccessFilter>('all')
  const [requestedBlueprintId, setRequestedBlueprintId] = useState<string | null>(null)

  const visibleBlueprints = useMemo(() => {
    if (!catalog.result) return []
    const normalizedQuery = query.trim().toLowerCase()

    return catalog.result.blueprints.filter((blueprint) => {
      const matchesQuery =
        !normalizedQuery ||
        blueprint.outputName.toLowerCase().includes(normalizedQuery) ||
        blueprint.outputTypeLabel.toLowerCase().includes(normalizedQuery) ||
        blueprint.key.toLowerCase().includes(normalizedQuery) ||
        blueprint.ingredients.some((ingredient) =>
          ingredient.name.toLowerCase().includes(normalizedQuery)
        )
      const matchesAccess =
        accessFilter === 'all' ||
        (accessFilter === 'default' && blueprint.availableByDefault) ||
        (accessFilter === 'mission' &&
          !blueprint.availableByDefault &&
          blueprint.unlockingMissionCount > 0)
      return matchesQuery && matchesAccess
    })
  }, [accessFilter, catalog.result, query])

  const selectedBlueprint =
    visibleBlueprints.find((blueprint) => blueprint.id === requestedBlueprintId) ??
    visibleBlueprints[0] ??
    null
  const detail = useBlueprintDetail(
    selectedBlueprint?.id ?? null,
    catalog.result?.updatedAt ?? null,
    catalog.result?.state ?? null
  )
  const totalCount = catalog.result?.blueprints.length ?? 0
  const retainedCatalogError = catalog.result !== null && catalog.error !== null

  const handleBlueprintKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number
  ): void => {
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? visibleBlueprints.length - 1
          : event.key === 'ArrowUp'
            ? Math.max(index - 1, 0)
            : event.key === 'ArrowDown'
              ? Math.min(index + 1, visibleBlueprints.length - 1)
              : null
    if (nextIndex === null || nextIndex === index) return

    event.preventDefault()
    const nextBlueprint = visibleBlueprints[nextIndex]
    setRequestedBlueprintId(nextBlueprint.id)
    requestAnimationFrame(() =>
      document.getElementById(`blueprint-option-${nextBlueprint.id}`)?.focus()
    )
  }

  const retryCatalog = (refresh = false): void => {
    document.getElementById('blueprint-catalog-title')?.focus()
    void catalog.reload(refresh)
  }

  const retryDetail = (): void => {
    document.getElementById('blueprint-detail-title')?.focus()
    void detail.reload()
  }

  return (
    <main className="blueprint-workspace" id="panel-blueprints" aria-labelledby="tab-blueprints">
      <section className="blueprint-catalog" aria-labelledby="blueprint-catalog-title">
        <div className="section-heading blueprint-catalog__heading">
          <div>
            <span className="section-icon">
              <Hammer size={17} />
            </span>
            <div>
              <h1 id="blueprint-catalog-title" tabIndex={-1}>
                Blueprint catalog
              </h1>
              <p>Inspect every craftable output and its acquisition path.</p>
            </div>
          </div>
          <div className="blueprint-catalog__status" aria-live="polite">
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
            <strong>{countFormatter.format(visibleBlueprints.length)}</strong>
            <span>of {countFormatter.format(totalCount)}</span>
          </div>
        </div>

        <div className="blueprint-tool-stack">
          <div className="blueprint-tools">
            <label className="search-field">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search blueprints</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search output, type, material, or key"
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
            <div className="blueprint-catalog__warning" role="alert">
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
        </div>

        <div className="filter-strip blueprint-filter-strip" aria-label="Filter blueprint access">
          {ACCESS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={accessFilter === filter.value ? 'is-active' : ''}
              aria-pressed={accessFilter === filter.value}
              onClick={() => setAccessFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="blueprint-list" aria-busy={catalog.loading && !catalog.result}>
          <div className="blueprint-list__header" aria-hidden="true">
            <span>Blueprint output</span>
            <span>Type</span>
            <span>Craft</span>
            <span>Access</span>
          </div>
          <div className="blueprint-list__body" role="listbox" aria-label="Blueprints">
            {!catalog.result && catalog.loading && <BlueprintListSkeleton />}

            {!catalog.result && catalog.error && (
              <div className="blueprint-empty" role="alert">
                <Database size={22} />
                <strong>Blueprint catalog unavailable</strong>
                <span>{catalog.error}</span>
                <button type="button" onClick={() => retryCatalog()}>
                  Retry catalog
                </button>
              </div>
            )}

            {catalog.result &&
              visibleBlueprints.map((blueprint, index) => {
                const selected = blueprint.id === selectedBlueprint?.id
                return (
                  <button
                    id={`blueprint-option-${blueprint.id}`}
                    className={`blueprint-row ${selected ? 'blueprint-row--selected' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    key={blueprint.id}
                    onClick={() => setRequestedBlueprintId(blueprint.id)}
                    onKeyDown={(event) => handleBlueprintKeyDown(event, index)}
                  >
                    <span className="blueprint-row__identity">
                      <strong>{blueprint.outputName}</strong>
                      <small>{blueprint.key}</small>
                    </span>
                    <span className="blueprint-row__type">{blueprint.outputTypeLabel}</span>
                    <span className="blueprint-row__time">{blueprint.craftTimeLabel}</span>
                    <BlueprintAccess blueprint={blueprint} compact />
                  </button>
                )
              })}

            {catalog.result && visibleBlueprints.length === 0 && (
              <div className="blueprint-empty">
                <Search size={22} />
                <strong>No matching blueprints</strong>
                <span>Try another output, material, item type, or access filter.</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="blueprint-detail" aria-labelledby="blueprint-detail-title">
        <div className="blueprint-detail__scroll">
          {!selectedBlueprint && catalog.loading && <BlueprintDetailSkeleton />}

          {!selectedBlueprint && !catalog.loading && (
            <div className="blueprint-detail__empty">
              <PackageOpen size={30} />
              <strong>Select a blueprint</strong>
              <span>Crafting requirements and unlock missions will appear here.</span>
            </div>
          )}

          {selectedBlueprint && (
            <BlueprintDetailPane
              summary={selectedBlueprint}
              detail={detail.result?.blueprint ?? null}
              detailState={detail.result?.state ?? null}
              detailMessage={detail.result?.message ?? null}
              imageDataUrl={
                selectedBlueprint.imageKey
                  ? (catalog.result?.icons[selectedBlueprint.imageKey] ?? null)
                  : null
              }
              loading={detail.loading}
              error={detail.error}
              onRetry={retryDetail}
            />
          )}
        </div>
      </aside>
    </main>
  )
}

function BlueprintAccess({
  blueprint,
  compact = false
}: {
  blueprint: BlueprintSummary
  compact?: boolean
}): React.JSX.Element {
  if (blueprint.availableByDefault) {
    return (
      <span className={`blueprint-access blueprint-access--default ${compact ? 'is-compact' : ''}`}>
        <Unlock size={12} />
        {compact ? 'Default' : 'Available by default'}
      </span>
    )
  }

  return (
    <span className={`blueprint-access blueprint-access--mission ${compact ? 'is-compact' : ''}`}>
      <Lock size={12} />
      {blueprint.unlockingMissionCount === 0
        ? 'Mission not mapped'
        : compact
          ? `${blueprint.unlockingMissionCount} mission${
              blueprint.unlockingMissionCount === 1 ? '' : 's'
            }`
          : `${blueprint.unlockingMissionCount} unlocking mission${
              blueprint.unlockingMissionCount === 1 ? '' : 's'
            }`}
    </span>
  )
}

function BlueprintDetailPane({
  summary,
  detail,
  detailState,
  detailMessage,
  imageDataUrl,
  loading,
  error,
  onRetry
}: {
  summary: BlueprintSummary
  detail: BlueprintDetail | null
  detailState: 'game' | 'cached' | null
  detailMessage: string | null
  imageDataUrl: string | null
  loading: boolean
  error: string | null
  onRetry: () => void
}): React.JSX.Element {
  const requirementGroups = detail?.requirementGroups ?? []
  const missions = detail?.unlockingMissions ?? []

  return (
    <>
      <header className="blueprint-detail__header">
        <BlueprintOutputMark imageDataUrl={imageDataUrl} />
        <div className="blueprint-detail__identity">
          <span>
            {summary.outputTypeLabel}
            {summary.outputGrade ? ` · Grade ${summary.outputGrade}` : ''}
          </span>
          <h2 id="blueprint-detail-title" tabIndex={-1}>
            {summary.outputName}
          </h2>
          <small>{summary.key}</small>
        </div>
        {summary.webUrl && (
          <a
            className="blueprint-detail__external"
            href={summary.webUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on Wiki
            <ExternalLink size={13} />
          </a>
        )}
      </header>

      <div className="blueprint-detail__body">
        <dl className="blueprint-facts">
          <div>
            <dt>
              <Clock3 size={13} />
              Craft time
            </dt>
            <dd>{summary.craftTimeLabel}</dd>
          </div>
          <div>
            <dt>
              <Hammer size={13} />
              Inputs
            </dt>
            <dd>{summary.ingredientCount}</dd>
          </div>
          <div>
            <dt>
              {summary.availableByDefault ? <Unlock size={13} /> : <Lock size={13} />}
              Access
            </dt>
            <dd>
              <BlueprintAccess blueprint={summary} />
            </dd>
          </div>
        </dl>

        {(loading || detailState) && (
          <div className="blueprint-detail__source" aria-live="polite">
            <span
              title={detailMessage ?? undefined}
              className={`blueprint-source-state blueprint-source-state--${
                loading ? 'loading' : detailState
              }`}
            >
              <span />
              {loading
                ? 'Resolving game records'
                : detailState === 'game'
                  ? 'Installed game detail'
                  : 'Cached game detail'}
            </span>
            <span>{detail?.gameVersion ?? summary.gameVersion}</span>
          </div>
        )}

        {error && (
          <div className="blueprint-detail__error" role="alert">
            <div>
              <strong>Full blueprint detail unavailable</strong>
              <span>{error}</span>
            </div>
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}

        <section className="blueprint-detail__section" aria-labelledby="craft-requirements-title">
          <div className="blueprint-detail__section-heading">
            <div>
              <Hammer size={15} />
              <h3 id="craft-requirements-title">Crafting requirements</h3>
            </div>
            <span>{summary.ingredientCount} inputs</span>
          </div>

          {loading ? (
            <RequirementSkeleton />
          ) : error ? (
            <div className="blueprint-inline-empty">
              Crafting groups could not be resolved from the retained catalog.
            </div>
          ) : (
            <div className="requirement-list">
              {requirementGroups.map((group) => (
                <RequirementGroup key={group.key} group={group} />
              ))}
              {requirementGroups.length === 0 && (
                <div className="blueprint-inline-empty">
                  No crafting inputs are reported for this blueprint.
                </div>
              )}
            </div>
          )}
        </section>

        <section className="blueprint-detail__section" aria-labelledby="unlock-missions-title">
          <div className="blueprint-detail__section-heading">
            <div>
              <Route size={15} />
              <h3 id="unlock-missions-title">Blueprint access</h3>
            </div>
            {!summary.availableByDefault && <span>{summary.unlockingMissionCount} missions</span>}
          </div>

          {summary.availableByDefault ? (
            <div className="blueprint-access-note blueprint-access-note--default">
              <Unlock size={17} />
              <div>
                <strong>No mission required</strong>
                <span>This blueprint is available to craft by default.</span>
              </div>
            </div>
          ) : loading ? (
            <MissionSkeleton />
          ) : missions.length > 0 ? (
            <div className="mission-list">
              {missions.map((mission) => {
                const content = (
                  <>
                    <Route size={15} />
                    <span>
                      <strong>{mission.title}</strong>
                      <small>
                        {[mission.rewardScope, formatMissionChance(mission.chance)]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </span>
                    {mission.webUrl && <ExternalLink size={13} />}
                  </>
                )
                return mission.webUrl ? (
                  <a
                    className="mission-row"
                    href={mission.webUrl}
                    target="_blank"
                    rel="noreferrer"
                    key={`${mission.title}-${mission.webUrl}`}
                  >
                    {content}
                  </a>
                ) : (
                  <div className="mission-row" key={mission.id}>
                    {content}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="blueprint-access-note">
              <Lock size={17} />
              <div>
                <strong>
                  {error ? 'Mission details could not be resolved' : 'No unlocking mission mapped'}
                </strong>
                <span>
                  {error
                    ? 'Retry the detail request to identify the required contract.'
                    : 'The game-data source does not currently name a mission for this blueprint.'}
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function RequirementGroup({ group }: { group: BlueprintRequirementGroup }): React.JSX.Element {
  return (
    <div className="requirement-group">
      <div className="requirement-group__identity">
        <strong>{group.name}</strong>
        <span>
          {group.requiredCount} {group.requiredCount === 1 ? 'selection' : 'selections'} required
        </span>
      </div>
      <div className="requirement-group__ingredients">
        {group.ingredients.map((ingredient, index) => (
          <div className="requirement-ingredient" key={`${ingredient.name}-${index}`}>
            <span className="requirement-ingredient__kind">
              {ingredient.kind === 'resource' ? <Database size={13} /> : <Box size={13} />}
            </span>
            <span>
              {ingredient.webUrl ? (
                <a href={ingredient.webUrl} target="_blank" rel="noreferrer">
                  {ingredient.name}
                </a>
              ) : (
                <strong>{ingredient.name}</strong>
              )}
              <small>
                {ingredient.kind === 'resource' ? 'Resource' : 'Item'}
                {ingredient.minQuality !== null ? ` · Quality ${ingredient.minQuality}+` : ''}
              </small>
            </span>
            <strong>{formatIngredientQuantity(ingredient)}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function BlueprintOutputMark({ imageDataUrl }: { imageDataUrl: string | null }): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = imageDataUrl !== null && failedUrl !== imageDataUrl

  return (
    <span
      className={`blueprint-detail__mark ${showImage ? 'blueprint-detail__mark--image' : ''}`}
      aria-hidden="true"
      title={showImage ? 'Icon extracted from installed game files' : undefined}
    >
      {showImage ? (
        <img src={imageDataUrl} alt="" onError={() => setFailedUrl(imageDataUrl)} />
      ) : (
        <Box size={20} />
      )}
    </span>
  )
}

function formatIngredientQuantity(
  ingredient: BlueprintIngredient & { minQuality?: number | null }
): string {
  if (ingredient.quantityScu !== null) {
    return `${quantityFormatter.format(ingredient.quantityScu)} SCU`
  }
  if (ingredient.quantity !== null) return `× ${quantityFormatter.format(ingredient.quantity)}`
  return 'Required'
}

function formatMissionChance(chance: number | null): string | null {
  if (chance === null) return null
  if (chance === 1) return 'Guaranteed unlock'
  return `${Math.round(chance * 100)}% unlock chance`
}

function BlueprintListSkeleton(): React.JSX.Element {
  return (
    <div className="blueprint-list-skeleton" aria-hidden="true">
      {Array.from({ length: 10 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}

function BlueprintDetailSkeleton(): React.JSX.Element {
  return (
    <div className="blueprint-detail-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  )
}

function MissionSkeleton(): React.JSX.Element {
  return (
    <div className="mission-skeleton" aria-hidden="true">
      <span />
      <span />
    </div>
  )
}

function RequirementSkeleton(): React.JSX.Element {
  return (
    <div className="requirement-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}
