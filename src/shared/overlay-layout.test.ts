import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_SHORTCUTS, type OverlaySettings, type OverlaySettingsPatch } from './contracts'
import { getOverlayFallbackLayout, getOverlayLayoutKey } from './overlay-layout'

function createSettings(overrides: OverlaySettingsPatch = {}): OverlaySettings {
  return {
    selectedMaterialIds: ['agricium-ore', 'laranite-raw', 'riccite-ore'],
    clusterMax: 5,
    visible: true,
    compact: false,
    opacity: 0.58,
    fontScale: 1,
    placement: 'top-right',
    customPosition: null,
    spotlightMaterialId: null,
    shortcuts: { ...DEFAULT_SHORTCUTS },
    ...overrides
  }
}

test('scales the overlay window with its font size', () => {
  assert.deepEqual(getOverlayFallbackLayout(createSettings()), {
    width: 420,
    height: 340,
    headerHeight: 42
  })
  assert.deepEqual(getOverlayFallbackLayout(createSettings({ fontScale: 1.5 })), {
    width: 630,
    height: 508,
    headerHeight: 63
  })
})

test('sizes fallback layouts for compact, spotlight, and empty states', () => {
  assert.equal(getOverlayFallbackLayout(createSettings({ compact: true })).height, 318)
  assert.equal(
    getOverlayFallbackLayout(createSettings({ spotlightMaterialId: 'agricium-ore' })).height,
    144
  )
  assert.equal(getOverlayFallbackLayout(createSettings({ selectedMaterialIds: [] })).height, 160)
})

test('changes the layout key only for settings that affect rendered dimensions', () => {
  const settings = createSettings()

  assert.equal(getOverlayLayoutKey(settings), getOverlayLayoutKey({ ...settings, opacity: 0.8 }))
  assert.notEqual(
    getOverlayLayoutKey(settings),
    getOverlayLayoutKey({ ...settings, fontScale: 1.25 })
  )
  assert.notEqual(
    getOverlayLayoutKey(settings),
    getOverlayLayoutKey({ ...settings, clusterMax: 8 })
  )
})
