import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  mergeSettings,
  normalizeSettings,
  parsePersistedSettings
} from './settings-store'

test('normalizes persisted settings and clamps opacity', () => {
  assert.deepEqual(
    normalizeSettings({
      selectedMaterialIds: ['agricium-ore', 'agricium-ore', 'riccite-ore'],
      clusterMax: 7,
      visible: false,
      compact: true,
      opacity: 2,
      fontScale: 4,
      placement: 'bottom-left',
      spotlightMaterialId: 'riccite-ore'
    }),
    {
      selectedMaterialIds: ['agricium-ore', 'riccite-ore'],
      clusterMax: 7,
      visible: false,
      compact: true,
      opacity: 0.9,
      fontScale: 1.6,
      placement: 'bottom-left',
      customPosition: null,
      spotlightMaterialId: 'riccite-ore',
      shortcuts: DEFAULT_SETTINGS.shortcuts
    }
  )
})

test('normalizes overlay font scale to supported steps', () => {
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, fontScale: 0.1 }).fontScale, 0.8)
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, fontScale: 1.234 }).fontScale, 1.25)
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, fontScale: 3 }).fontScale, 1.6)
})

test('migrates previous backdrop defaults without changing target selection', () => {
  const loaded = parsePersistedSettings({
    ...DEFAULT_SETTINGS,
    settingsVersion: 1,
    selectedMaterialIds: ['agricium-ore', 'riccite-ore'],
    opacity: 0.94
  })

  assert.equal(loaded.settings.opacity, 0.58)
  assert.deepEqual(loaded.settings.selectedMaterialIds, ['agricium-ore', 'riccite-ore'])
  assert.equal(loaded.needsSave, true)

  const versionTwo = parsePersistedSettings({
    ...DEFAULT_SETTINGS,
    settingsVersion: 2,
    opacity: 0.72
  })
  assert.equal(versionTwo.settings.opacity, 0.58)
})

test('preserves a current user opacity setting', () => {
  const loaded = parsePersistedSettings({
    ...DEFAULT_SETTINGS,
    settingsVersion: SETTINGS_VERSION,
    opacity: 0.84
  })

  assert.equal(loaded.settings.opacity, 0.84)
  assert.equal(loaded.needsSave, false)
})

test('clears a spotlight that is no longer selected', () => {
  const current = {
    ...DEFAULT_SETTINGS,
    selectedMaterialIds: ['agricium-ore', 'riccite-ore'],
    spotlightMaterialId: 'agricium-ore'
  }

  assert.equal(
    mergeSettings(current, { selectedMaterialIds: ['riccite-ore'] }).spotlightMaterialId,
    null
  )
})

test('normalizes custom overlay coordinates', () => {
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    customPosition: { x: 125.7, y: -48.2 }
  })

  assert.deepEqual(settings.customPosition, { x: 126, y: -48 })
})

test('rejects duplicate global shortcuts', () => {
  assert.throws(
    () =>
      normalizeSettings({
        ...DEFAULT_SETTINGS,
        shortcuts: {
          ...DEFAULT_SETTINGS.shortcuts,
          'next-target': DEFAULT_SETTINGS.shortcuts['toggle-overlay']
        }
      }),
    /different shortcut/
  )
})

test('rejects more than four selected targets', () => {
  assert.throws(
    () =>
      normalizeSettings({
        ...DEFAULT_SETTINGS,
        selectedMaterialIds: ['one', 'two', 'three', 'four', 'five']
      }),
    /no more than 4/
  )
})
