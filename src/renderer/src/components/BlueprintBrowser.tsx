import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Box,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Database,
  ExternalLink,
  FileSearch,
  Hammer,
  ListChecks,
  Lock,
  PackageOpen,
  Route,
  Search,
  TriangleAlert,
  Unlock
} from 'lucide-react'

import type {
  BlueprintDetail,
  BlueprintIngredient,
  BlueprintOwnershipRecord,
  BlueprintOwnershipSnapshot,
  BlueprintRequirementGroup,
  BlueprintSummary,
  BlueprintUnlockMission
} from '../../../shared/contracts'
import {
  useBlueprintCatalog,
  useBlueprintDetail,
  useBlueprintOwnership,
  useBlueprintThumbnail
} from '../hooks/useBlueprints'
import {
  getBlueprintCategoryOptions,
  getBlueprintSubcategoryOptions,
  matchesBlueprintCategory
} from '../lib/blueprint-categories'

type BlueprintAccessFilter = 'all' | 'mission' | 'default'
type BlueprintCollectionFilter = 'all' | 'owned' | 'obtainable'

const ACCESS_FILTERS: Array<{ value: BlueprintAccessFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'mission', label: 'Mission' },
  { value: 'default', label: 'Default' }
]
const COLLECTION_FILTERS: Array<{ value: BlueprintCollectionFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned' },
  { value: 'obtainable', label: 'Obtainable' }
]
const BLUEPRINT_RENDER_BATCH_SIZE = 80

const quantityFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 3
})
const missionChanceFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1
})
const countFormatter = new Intl.NumberFormat('en-US')
const ownershipDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export default function BlueprintBrowser({
  gameDataRevision
}: {
  gameDataRevision: number
}): React.JSX.Element {
  const catalog = useBlueprintCatalog(gameDataRevision)
  const ownership = useBlueprintOwnership()
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [subcategoryFilter, setSubcategoryFilter] = useState('')
  const [accessFilter, setAccessFilter] = useState<BlueprintAccessFilter>('all')
  const [collectionFilter, setCollectionFilter] = useState<BlueprintCollectionFilter>('all')
  const [requestedBlueprintId, setRequestedBlueprintId] = useState<string | null>(null)
  const [renderWindow, setRenderWindow] = useState({
    scope: '',
    count: BLUEPRINT_RENDER_BATCH_SIZE
  })
  const categoryOptions = useMemo(
    () => getBlueprintCategoryOptions(catalog.result?.blueprints ?? []),
    [catalog.result]
  )
  const activeCategoryFilter = categoryOptions.some((category) => category.value === categoryFilter)
    ? categoryFilter
    : ''
  const subcategoryOptions = useMemo(
    () => getBlueprintSubcategoryOptions(catalog.result?.blueprints ?? [], activeCategoryFilter),
    [activeCategoryFilter, catalog.result]
  )
  const activeSubcategoryFilter = subcategoryOptions.some(
    (subcategory) => subcategory.value === subcategoryFilter
  )
    ? subcategoryFilter
    : ''

  const visibleBlueprints = useMemo(() => {
    if (!catalog.result) return []
    const normalizedQuery = query.trim().toLowerCase()

    return catalog.result.blueprints.filter((blueprint) => {
      const ownershipRecord = getOwnershipRecord(blueprint, ownership.result)
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
      const matchesCollection =
        collectionFilter === 'all' ||
        (collectionFilter === 'owned' && ownershipRecord !== null) ||
        (collectionFilter === 'obtainable' &&
          ownershipRecord === null &&
          blueprint.unlockingMissionCount > 0)
      return (
        matchesQuery &&
        matchesBlueprintCategory(blueprint, activeCategoryFilter, activeSubcategoryFilter) &&
        matchesAccess &&
        matchesCollection
      )
    })
  }, [
    accessFilter,
    catalog.result,
    activeCategoryFilter,
    activeSubcategoryFilter,
    collectionFilter,
    ownership.result,
    query
  ])

  const selectedBlueprint =
    visibleBlueprints.find((blueprint) => blueprint.id === requestedBlueprintId) ??
    visibleBlueprints[0] ??
    null
  const renderScope = [
    query,
    activeCategoryFilter,
    activeSubcategoryFilter,
    accessFilter,
    collectionFilter,
    catalog.result?.updatedAt ?? ''
  ].join('\u001f')
  const renderedBlueprintCount =
    renderWindow.scope === renderScope ? renderWindow.count : BLUEPRINT_RENDER_BATCH_SIZE
  const selectedBlueprintIndex = selectedBlueprint
    ? visibleBlueprints.findIndex((blueprint) => blueprint.id === selectedBlueprint.id)
    : -1
  const effectiveRenderedBlueprintCount = Math.max(
    renderedBlueprintCount,
    selectedBlueprintIndex + 1
  )
  const renderedBlueprints = visibleBlueprints.slice(0, effectiveRenderedBlueprintCount)
  const detail = useBlueprintDetail(
    selectedBlueprint?.id ?? null,
    catalog.result?.updatedAt ?? null,
    catalog.result?.state ?? null
  )
  const packagedImageDataUrl =
    selectedBlueprint?.imageKey && catalog.result
      ? (catalog.result.icons[selectedBlueprint.imageKey] ?? null)
      : null
  const thumbnail = useBlueprintThumbnail(
    selectedBlueprint?.id ?? null,
    packagedImageDataUrl,
    catalog.result?.updatedAt ?? null
  )
  const totalCount = catalog.result?.blueprints.length ?? 0
  const ownedCount =
    ownership.result?.ownedCount ??
    catalog.result?.blueprints.filter((blueprint) => blueprint.availableByDefault).length ??
    0
  const retainedCatalogError = catalog.result !== null && catalog.error !== null
  const ownershipRecord = selectedBlueprint
    ? getOwnershipRecord(selectedBlueprint, ownership.result)
    : null

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
    if (nextIndex >= effectiveRenderedBlueprintCount) {
      setRenderWindow({
        scope: renderScope,
        count: Math.min(visibleBlueprints.length, nextIndex + BLUEPRINT_RENDER_BATCH_SIZE)
      })
    }
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

  const handleBlueprintListScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const list = event.currentTarget
    if (
      renderedBlueprintCount >= visibleBlueprints.length ||
      list.scrollTop + list.clientHeight < list.scrollHeight - 600
    ) {
      return
    }
    setRenderWindow((current) => ({
      scope: renderScope,
      count: Math.min(
        visibleBlueprints.length,
        (current.scope === renderScope ? current.count : BLUEPRINT_RENDER_BATCH_SIZE) +
          BLUEPRINT_RENDER_BATCH_SIZE
      )
    }))
  }

  return (
    <main
      className="blueprint-workspace"
      id="panel-blueprints"
      role="tabpanel"
      aria-labelledby="tab-blueprints"
    >
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
            <small>{countFormatter.format(ownedCount)} owned</small>
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
                placeholder="Search blueprints"
              />
            </label>
            <button
              className="icon-text-button"
              type="button"
              disabled={ownership.loading || ownership.result?.status === 'scanning'}
              onClick={() => void ownership.rescan()}
              title="Scan Game.log and retained log backups"
            >
              <FileSearch
                size={15}
                className={ownership.result?.status === 'scanning' ? 'is-spinning' : ''}
              />
              Logs
            </button>
          </div>
          {ownership.result && (
            <div
              className="blueprint-log-status"
              aria-live="polite"
              title={ownership.result.message}
            >
              <span
                className={`blueprint-source-state blueprint-source-state--${ownershipStatusTone(
                  ownership.result.status
                )}`}
              >
                <span />
                {ownershipStatusLabel(ownership.result)}
              </span>
              <span>{ownership.result.message}</span>
            </div>
          )}
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
          {ownership.result?.warning && (
            <div
              className="blueprint-catalog__warning blueprint-catalog__warning--static"
              role="alert"
            >
              <TriangleAlert size={14} />
              <span>
                <strong>Blueprint ownership data was recovered</strong>
                <small>{ownership.result.warning}</small>
              </span>
            </div>
          )}
          {(ownership.error !== null ||
            (ownership.result?.unresolvedReceiptNames.length ?? 0) > 0) && (
            <div
              className={`blueprint-catalog__warning ${
                ownership.error ? 'blueprint-catalog__warning--error' : ''
              }`}
              role={ownership.error ? 'alert' : 'status'}
            >
              {ownership.error ? <TriangleAlert size={14} /> : <CircleHelp size={14} />}
              <span>
                <strong>
                  {ownership.error
                    ? 'Blueprint ownership could not be updated'
                    : `${ownership.result?.unresolvedReceiptNames.length ?? 0} log receipt${
                        ownership.result?.unresolvedReceiptNames.length === 1 ? '' : 's'
                      } need manual matching`}
                </strong>
                <small>
                  {ownership.error ??
                    ownership.result?.unresolvedReceiptNames.join(', ') ??
                    'Select the matching blueprint and mark it owned.'}
                </small>
              </span>
              <button
                type="button"
                onClick={() => {
                  if (ownership.error) {
                    void ownership.retry()
                    return
                  }
                  setQuery(toReceiptReviewQuery(ownership.result?.unresolvedReceiptNames[0] ?? ''))
                  setCategoryFilter('')
                  setSubcategoryFilter('')
                  setCollectionFilter('all')
                  setAccessFilter('all')
                }}
              >
                {ownership.error ? 'Retry' : 'Review'}
              </button>
            </div>
          )}
        </div>

        <div className="blueprint-filter-deck">
          <fieldset
            className="blueprint-filter-group blueprint-taxonomy-filter"
            disabled={!catalog.result}
          >
            <legend>Category</legend>
            <div className="filter-strip" aria-label="Filter blueprints by category">
              <button
                type="button"
                className={activeCategoryFilter === '' ? 'is-active' : ''}
                aria-pressed={activeCategoryFilter === ''}
                onClick={() => {
                  setCategoryFilter('')
                  setSubcategoryFilter('')
                }}
              >
                All
              </button>
              {categoryOptions.map((category) => (
                <button
                  key={category.value}
                  type="button"
                  className={activeCategoryFilter === category.value ? 'is-active' : ''}
                  aria-pressed={activeCategoryFilter === category.value}
                  onClick={() => {
                    setCategoryFilter(category.value)
                    setSubcategoryFilter('')
                  }}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </fieldset>
          {activeCategoryFilter && (
            <fieldset
              className="blueprint-filter-group blueprint-taxonomy-filter"
              disabled={!catalog.result}
            >
              <legend>Subcategory</legend>
              <div className="filter-strip" aria-label="Filter blueprints by subcategory">
                <button
                  type="button"
                  className={activeSubcategoryFilter === '' ? 'is-active' : ''}
                  aria-pressed={activeSubcategoryFilter === ''}
                  onClick={() => setSubcategoryFilter('')}
                >
                  All
                </button>
                {subcategoryOptions.map((subcategory) => (
                  <button
                    key={subcategory.value}
                    type="button"
                    className={activeSubcategoryFilter === subcategory.value ? 'is-active' : ''}
                    aria-pressed={activeSubcategoryFilter === subcategory.value}
                    onClick={() => setSubcategoryFilter(subcategory.value)}
                  >
                    {subcategory.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset className="blueprint-filter-group">
            <legend>Collection</legend>
            <div className="filter-strip" aria-label="Filter blueprint collection">
              {COLLECTION_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  className={collectionFilter === filter.value ? 'is-active' : ''}
                  aria-pressed={collectionFilter === filter.value}
                  onClick={() => setCollectionFilter(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="blueprint-filter-group">
            <legend>Access</legend>
            <div className="filter-strip" aria-label="Filter blueprint access">
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
          </fieldset>
        </div>

        <div className="blueprint-list" aria-busy={catalog.loading && !catalog.result}>
          <div className="blueprint-list__header" aria-hidden="true">
            <span>Blueprint output</span>
            <span>Collection</span>
          </div>
          <div
            className="blueprint-list__body"
            role="listbox"
            aria-label="Blueprints"
            onScroll={handleBlueprintListScroll}
          >
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
              renderedBlueprints.map((blueprint, index) => {
                const selected = blueprint.id === selectedBlueprint?.id
                const rowOwnership = getOwnershipRecord(blueprint, ownership.result)
                return (
                  <button
                    id={`blueprint-option-${blueprint.id}`}
                    className={`blueprint-row ${selected ? 'blueprint-row--selected' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-posinset={index + 1}
                    aria-setsize={visibleBlueprints.length}
                    tabIndex={selected ? 0 : -1}
                    key={blueprint.id}
                    onClick={() => setRequestedBlueprintId(blueprint.id)}
                    onKeyDown={(event) => handleBlueprintKeyDown(event, index)}
                  >
                    <span className="blueprint-row__identity">
                      <strong>{blueprint.outputName}</strong>
                      <small className="blueprint-row__meta">
                        <span>{blueprint.outputTypeLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className="blueprint-row__time">{blueprint.craftTimeLabel}</span>
                      </small>
                    </span>
                    <BlueprintCollectionStatus
                      blueprint={blueprint}
                      record={rowOwnership}
                      compact
                    />
                  </button>
                )
              })}

            {catalog.result && visibleBlueprints.length === 0 && (
              <div className="blueprint-empty">
                <Search size={22} />
                <strong>No matching blueprints</strong>
                <span>Try another output, material, category, access, or collection filter.</span>
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
              imageDataUrl={packagedImageDataUrl ?? thumbnail.result?.dataUrl ?? null}
              imageTitle={
                packagedImageDataUrl
                  ? 'Icon extracted from installed game files'
                  : thumbnail.result?.status === 'ready'
                    ? thumbnail.result.message
                    : null
              }
              loading={detail.loading}
              error={detail.error}
              onRetry={retryDetail}
              ownershipRecord={ownershipRecord}
              ownershipUpdating={ownership.updatingBlueprintId === selectedBlueprint.id}
              onSetOwned={(owned) => void ownership.setOwned(selectedBlueprint.id, owned)}
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

function BlueprintCollectionStatus({
  blueprint,
  record,
  compact = false
}: {
  blueprint: BlueprintSummary
  record: BlueprintOwnershipRecord | null
  compact?: boolean
}): React.JSX.Element {
  if (record) {
    const sourceLabel =
      record.source === 'default'
        ? 'Available by default'
        : record.source === 'log'
          ? record.acquiredAt
            ? `Detected in Game.log on ${formatOwnershipDate(record.acquiredAt)}`
            : 'Detected in Game.log'
          : 'Marked owned manually'
    const visibleLabel =
      record.source === 'default'
        ? 'Default access'
        : record.source === 'log'
          ? 'Log confirmed'
          : 'Manually owned'
    return (
      <span
        className={`blueprint-collection blueprint-collection--owned ${
          compact ? 'is-compact' : ''
        }`}
        title={sourceLabel}
      >
        <CheckCircle2 size={12} />
        {compact ? (record.source === 'default' ? 'Default' : 'Owned') : visibleLabel}
      </span>
    )
  }

  if (blueprint.unlockingMissionCount > 0) {
    return (
      <span
        className={`blueprint-collection blueprint-collection--obtainable ${
          compact ? 'is-compact' : ''
        }`}
      >
        <Route size={12} />
        Obtainable
      </span>
    )
  }

  return (
    <span
      className={`blueprint-collection blueprint-collection--unknown ${
        compact ? 'is-compact' : ''
      }`}
      title="No ownership receipt or unlocking mission is currently mapped"
    >
      <CircleHelp size={12} />
      Unconfirmed
    </span>
  )
}

function BlueprintDetailPane({
  summary,
  detail,
  detailState,
  detailMessage,
  imageDataUrl,
  imageTitle,
  loading,
  error,
  onRetry,
  ownershipRecord,
  ownershipUpdating,
  onSetOwned
}: {
  summary: BlueprintSummary
  detail: BlueprintDetail | null
  detailState: 'game' | 'cached' | null
  detailMessage: string | null
  imageDataUrl: string | null
  imageTitle: string | null
  loading: boolean
  error: string | null
  onRetry: () => void
  ownershipRecord: BlueprintOwnershipRecord | null
  ownershipUpdating: boolean
  onSetOwned: (owned: boolean) => void
}): React.JSX.Element {
  const requirementGroups = detail?.requirementGroups ?? []
  const missions = detail?.unlockingMissions ?? []

  return (
    <>
      <header className="blueprint-detail__header">
        <BlueprintOutputMark imageDataUrl={imageDataUrl} imageTitle={imageTitle} />
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
        <div className="blueprint-detail__actions">
          {ownershipRecord?.source === 'default' || ownershipRecord?.source === 'log' ? (
            <span
              className="blueprint-ownership-action blueprint-ownership-action--confirmed"
              title={
                ownershipRecord.source === 'log' && ownershipRecord.acquiredAt
                  ? `Detected ${formatOwnershipDate(ownershipRecord.acquiredAt)}`
                  : undefined
              }
            >
              <CheckCircle2 size={13} />
              {ownershipRecord.source === 'default' ? 'Default access' : 'Log confirmed'}
            </span>
          ) : (
            <button
              className={`blueprint-ownership-action ${
                ownershipRecord?.source === 'manual' ? 'blueprint-ownership-action--confirmed' : ''
              }`}
              type="button"
              disabled={ownershipUpdating}
              aria-pressed={ownershipRecord?.source === 'manual'}
              onClick={() => onSetOwned(ownershipRecord?.source !== 'manual')}
            >
              {ownershipRecord?.source === 'manual' ? (
                <CheckCircle2 size={13} />
              ) : (
                <ListChecks size={13} />
              )}
              {ownershipUpdating
                ? 'Saving…'
                : ownershipRecord?.source === 'manual'
                  ? 'Clear manual mark'
                  : 'Mark owned'}
            </button>
          )}
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
        </div>
      </header>

      <div className="blueprint-detail__body">
        <section
          className="blueprint-output-profile"
          aria-labelledby="blueprint-output-profile-title"
        >
          <div className="blueprint-output-profile__heading">
            <h3 id="blueprint-output-profile-title">
              <PackageOpen size={15} />
              Crafted item
            </h3>
            {detail?.outputManufacturer && <span>{detail.outputManufacturer}</span>}
          </div>
          <p className={!detail ? 'is-loading' : undefined}>
            {detail
              ? (detail.outputDescription ?? 'No in-game description is available for this item.')
              : 'Resolving item description and default stats…'}
          </p>
          {detail && detail.outputStats.length > 0 && (
            <dl className="blueprint-output-stats">
              {detail.outputStats.map((stat) => (
                <div key={stat.key}>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

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
          <div>
            <dt>
              <ListChecks size={13} />
              Collection
            </dt>
            <dd>
              <BlueprintCollectionStatus blueprint={summary} record={ownershipRecord} />
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
            {!summary.availableByDefault && (
              <span>
                {summary.unlockingMissionCount}{' '}
                {summary.unlockingMissionCount === 1 ? 'mission' : 'missions'}
              </span>
            )}
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
            <div className="mission-access">
              <div className="mission-access__guide">
                <FileSearch size={16} />
                <div>
                  <strong>Find it in mobiGlas &gt; Contracts</strong>
                  <span>
                    Match the provider and contract type below. Bracketed title details are filled
                    in when the mission appears in game.
                  </span>
                </div>
              </div>
              <div className="mission-list">
                {missions.map((mission) => {
                  const route = formatMissionRoute(mission)
                  const access = formatMissionAccess(mission)
                  const content = (
                    <>
                      <Route size={15} />
                      <span className="mission-row__details">
                        <strong>{mission.title}</strong>
                        {route && <span className="mission-row__route">{route}</span>}
                        {access && <small>{access}</small>}
                      </span>
                      {mission.webUrl && <ExternalLink size={13} aria-hidden="true" />}
                    </>
                  )
                  return mission.webUrl ? (
                    <a
                      className="mission-row"
                      href={mission.webUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open full mission details on Star Citizen Wiki"
                      key={mission.id}
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

function getOwnershipRecord(
  blueprint: BlueprintSummary,
  ownership: BlueprintOwnershipSnapshot | null
): BlueprintOwnershipRecord | null {
  return (
    ownership?.records[blueprint.id] ??
    (blueprint.availableByDefault
      ? {
          blueprintId: blueprint.id,
          source: 'default',
          acquiredAt: null
        }
      : null)
  )
}

function ownershipStatusTone(
  status: BlueprintOwnershipSnapshot['status']
): 'game' | 'cached' | 'loading' | 'error' {
  if (status === 'watching') return 'game'
  if (status === 'scanning') return 'loading'
  if (status === 'error') return 'error'
  return 'cached'
}

function ownershipStatusLabel(ownership: BlueprintOwnershipSnapshot): string {
  if (ownership.status === 'watching') return `Watching ${ownership.channel ?? 'logs'}`
  if (ownership.status === 'scanning') return 'Scanning logs'
  if (ownership.status === 'error') return 'Log monitor error'
  return 'Logs unavailable'
}

function formatOwnershipDate(timestamp: string): string {
  return ownershipDateFormatter.format(new Date(timestamp))
}

function toReceiptReviewQuery(name: string): string {
  return name.replace(/^[A-Za-z]+\/\d{1,2}\/[A-Za-z]+\s+/, '')
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

function BlueprintOutputMark({
  imageDataUrl,
  imageTitle
}: {
  imageDataUrl: string | null
  imageTitle: string | null
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = imageDataUrl !== null && failedUrl !== imageDataUrl

  return (
    <span
      className={`blueprint-detail__mark ${showImage ? 'blueprint-detail__mark--image' : ''}`}
      aria-hidden="true"
      title={showImage ? (imageTitle ?? undefined) : undefined}
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

function formatMissionRoute(mission: BlueprintUnlockMission): string | null {
  const contractType =
    mission.contractType && mission.contractType !== mission.missionType
      ? mission.contractType
      : null
  const route = [mission.provider, mission.missionType, contractType].filter(Boolean).join(' · ')
  return route || null
}

function formatMissionAccess(mission: BlueprintUnlockMission): string | null {
  const systems =
    mission.starSystems.length > 0 ? `Available in ${mission.starSystems.join(' / ')}` : null
  const reputation = mission.reputationVaries
    ? 'Reputation rank varies'
    : mission.minimumReputation
      ? `${mission.minimumReputation} required`
      : null
  const access = [systems, reputation, formatMissionChance(mission.chance)]
    .filter(Boolean)
    .join(' · ')
  return access || null
}

function formatMissionChance(chance: number | null): string | null {
  if (chance === null) return null
  if (chance === 1) return 'Blueprint guaranteed'
  return `${missionChanceFormatter.format(chance)} blueprint chance`
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
