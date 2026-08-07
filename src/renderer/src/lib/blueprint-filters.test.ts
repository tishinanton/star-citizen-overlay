import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { BlueprintOwnershipSnapshot, BlueprintSummary } from '../../../shared/contracts'
import BlueprintNewBadge from '../components/BlueprintNewBadge'
import {
  DEFAULT_BLUEPRINT_FILTERS,
  filterBlueprints,
  getBlueprintEmptyState,
  hasActiveBlueprintFilters,
  type BlueprintFilterState
} from './blueprint-filters'

const BLUEPRINTS = [
  blueprint('new-owned', 'New armor', true, true, 'Char_Armor_Arms'),
  blueprint('new-mission', 'New weapon', true, false, 'WeaponPersonal'),
  blueprint('older-mission', 'Older weapon', false, false, 'WeaponPersonal')
]

const OWNERSHIP: BlueprintOwnershipSnapshot = {
  records: {
    'new-owned': { blueprintId: 'new-owned', source: 'manual', acquiredAt: null }
  },
  ownedCount: 1,
  defaultCount: 0,
  logCount: 0,
  manualCount: 1,
  status: 'watching',
  channel: 'LIVE',
  message: 'Watching logs.',
  warning: null,
  filesScanned: 1,
  filesSkipped: 0,
  unassignedReceiptCount: 0,
  earliestLogAt: null,
  lastScanAt: '2026-08-07T00:00:00.000Z',
  unresolvedReceiptNames: []
}

test('renders an accessible marker only for new blueprints', () => {
  const marked = renderToStaticMarkup(createElement(BlueprintNewBadge, { isNew: true }))
  assert.match(marked, /aria-label="New blueprint"/)
  assert.match(marked, />New</)
  assert.equal(renderToStaticMarkup(createElement(BlueprintNewBadge, { isNew: false })), '')
  assert.equal(renderToStaticMarkup(createElement(BlueprintNewBadge, {})), '')
})

test('filters new blueprints and composes with existing filters', () => {
  assert.deepEqual(
    filterBlueprints(BLUEPRINTS, OWNERSHIP, filters({ recency: 'new' })).map(({ id }) => id),
    ['new-owned', 'new-mission']
  )
  assert.deepEqual(
    filterBlueprints(
      BLUEPRINTS,
      OWNERSHIP,
      filters({ recency: 'new', collection: 'obtainable', access: 'mission' })
    ).map(({ id }) => id),
    ['new-mission']
  )
  assert.deepEqual(
    filterBlueprints(
      BLUEPRINTS,
      OWNERSHIP,
      filters({ recency: 'new', category: 'Weapons', query: 'missing' })
    ),
    []
  )
})

test('default filters restore the full catalog and have no active state', () => {
  assert.equal(hasActiveBlueprintFilters({ ...DEFAULT_BLUEPRINT_FILTERS }), false)
  assert.equal(hasActiveBlueprintFilters(filters({ recency: 'new' })), true)
  assert.deepEqual(
    filterBlueprints(BLUEPRINTS, OWNERSHIP, { ...DEFAULT_BLUEPRINT_FILTERS }).map(({ id }) => id),
    BLUEPRINTS.map(({ id }) => id)
  )
})

test('describes empty new-blueprint results and keeps reset available', () => {
  assert.deepEqual(getBlueprintEmptyState(filters({ recency: 'new' })), {
    title: 'No new blueprints match',
    description: 'Try another output, material, category, access, collection, or added filter.',
    canClear: true
  })
  assert.equal(getBlueprintEmptyState({ ...DEFAULT_BLUEPRINT_FILTERS }).canClear, false)
})

function filters(overrides: Partial<BlueprintFilterState>): BlueprintFilterState {
  return { ...DEFAULT_BLUEPRINT_FILTERS, ...overrides }
}

function blueprint(
  id: string,
  outputName: string,
  isNew: boolean,
  availableByDefault: boolean,
  outputType: string
): BlueprintSummary {
  return {
    id,
    key: id,
    isNew,
    outputName,
    outputClass: id,
    outputType,
    outputTypeLabel: outputType,
    outputGrade: null,
    craftTimeSeconds: 60,
    craftTimeLabel: '1 minute',
    availableByDefault,
    ingredientCount: 1,
    unlockingMissionCount: availableByDefault ? 0 : 1,
    ingredients: [{ name: 'Iron', kind: 'resource', quantity: 1, quantityScu: null, webUrl: null }],
    gameVersion: '4.9',
    imageKey: null,
    renderAsset: null,
    webUrl: null
  }
}
