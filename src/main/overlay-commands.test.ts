import assert from 'node:assert/strict'
import test from 'node:test'

import type { MiningMaterial, OverlaySettings } from '../shared/contracts'
import { DEFAULT_SETTINGS } from './settings-store'
import { OverlayCommandError, resolveOverlayCommand } from './overlay-commands'

const materials: MiningMaterial[] = [
  {
    id: 'agricium-ore',
    commodityId: 'agricium-ore',
    name: 'Agricium',
    displayName: 'Agricium',
    signature: 3_885,
    methods: ['Ship'],
    sourceUrl: 'https://example.test/agricium'
  },
  {
    id: 'riccite-ore--fps',
    commodityId: 'riccite-ore',
    name: 'Riccite (FPS)',
    displayName: 'Riccite (FPS)',
    signature: 3_385,
    methods: ['FPS'],
    sourceUrl: 'https://example.test/riccite'
  }
]

function settings(overrides: Partial<OverlaySettings> = {}): OverlaySettings {
  return {
    ...DEFAULT_SETTINGS,
    selectedMaterialIds: [],
    ...overrides
  }
}

test('adds exact item IDs in selection order and treats duplicates as no-ops', () => {
  assert.deepEqual(
    resolveOverlayCommand(
      { operation: 'overlay.item.add', itemId: 'riccite-ore--fps' },
      settings(),
      materials
    ),
    {
      result: 'applied',
      patch: { selectedMaterialIds: ['riccite-ore--fps'] }
    }
  )
  assert.deepEqual(
    resolveOverlayCommand(
      { operation: 'overlay.item.add', itemId: 'riccite-ore--fps' },
      settings({ selectedMaterialIds: ['riccite-ore--fps'] }),
      materials
    ),
    { result: 'noop', patch: null }
  )
})

test('rejects unavailable items and loading catalogs', () => {
  assert.throws(
    () =>
      resolveOverlayCommand(
        { operation: 'overlay.item.add', itemId: 'unknown' },
        settings(),
        materials
      ),
    (error) => error instanceof OverlayCommandError && error.code === 'item_not_found'
  )
  assert.throws(
    () =>
      resolveOverlayCommand(
        { operation: 'overlay.item.add', itemId: 'agricium-ore' },
        settings(),
        materials,
        true
      ),
    (error) => error instanceof OverlayCommandError && error.code === 'catalog_unavailable'
  )
})

test('adds items beyond the previous four-target limit', () => {
  assert.deepEqual(
    resolveOverlayCommand(
      { operation: 'overlay.item.add', itemId: 'agricium-ore' },
      settings({ selectedMaterialIds: ['one', 'two', 'three', 'four'] }),
      materials
    ),
    {
      result: 'applied',
      patch: { selectedMaterialIds: ['one', 'two', 'three', 'four', 'agricium-ore'] }
    }
  )
})

test('removes items without reordering and clears a removed spotlight', () => {
  assert.deepEqual(
    resolveOverlayCommand(
      { operation: 'overlay.item.remove', itemId: 'riccite-ore--fps' },
      settings({
        selectedMaterialIds: ['agricium-ore', 'riccite-ore--fps'],
        spotlightMaterialId: 'riccite-ore--fps'
      }),
      materials
    ),
    {
      result: 'applied',
      patch: {
        selectedMaterialIds: ['agricium-ore'],
        spotlightMaterialId: null
      }
    }
  )
})

test('sets compact mode explicitly and returns no-op for the current value', () => {
  assert.deepEqual(
    resolveOverlayCommand(
      { operation: 'overlay.compact.set', enabled: true },
      settings(),
      materials
    ),
    { result: 'applied', patch: { compact: true } }
  )
  assert.deepEqual(
    resolveOverlayCommand(
      { operation: 'overlay.compact.set', enabled: true },
      settings({ compact: true }),
      materials
    ),
    { result: 'noop', patch: null }
  )
})

test('cycles from all to first, advances, wraps, and leaves empty selection at all', () => {
  const selectedMaterialIds = ['agricium-ore', 'riccite-ore--fps']
  assert.deepEqual(
    resolveOverlayCommand(
      { operation: 'overlay.target.cycle' },
      settings({ selectedMaterialIds }),
      materials
    ).patch,
    { spotlightMaterialId: 'agricium-ore' }
  )
  assert.deepEqual(
    resolveOverlayCommand(
      { operation: 'overlay.target.cycle' },
      settings({ selectedMaterialIds, spotlightMaterialId: 'agricium-ore' }),
      materials
    ).patch,
    { spotlightMaterialId: 'riccite-ore--fps' }
  )
  assert.deepEqual(
    resolveOverlayCommand(
      { operation: 'overlay.target.cycle' },
      settings({ selectedMaterialIds, spotlightMaterialId: 'riccite-ore--fps' }),
      materials
    ).patch,
    { spotlightMaterialId: 'agricium-ore' }
  )
  assert.deepEqual(
    resolveOverlayCommand({ operation: 'overlay.target.cycle' }, settings(), materials),
    { result: 'noop', patch: null }
  )
})
