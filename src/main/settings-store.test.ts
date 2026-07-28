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
      appFontSize: 99,
      fontScale: 4,
      placement: 'bottom-left',
      spotlightMaterialId: 'riccite-ore'
    }),
    {
      selectedMaterialIds: ['agricium-ore', 'riccite-ore'],
      signatureOverrides: {},
      clusterMax: 7,
      visible: false,
      compact: true,
      opacity: 0.9,
      appFontSize: 20,
      fontScale: 1.6,
      placement: 'bottom-left',
      customPosition: null,
      spotlightMaterialId: 'riccite-ore',
      shortcuts: DEFAULT_SETTINGS.shortcuts,
      cloudApiUrl: DEFAULT_SETTINGS.cloudApiUrl
    }
  )
})

test('normalizes overlay font scale to supported steps', () => {
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, fontScale: 0.1 }).fontScale, 0.8)
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, fontScale: 1.234 }).fontScale, 1.25)
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, fontScale: 3 }).fontScale, 1.6)
})

test('normalizes application font size to the supported range', () => {
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, appFontSize: 10 }).appFontSize, 14)
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, appFontSize: 16.6 }).appFontSize, 17)
  assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, appFontSize: 24 }).appFontSize, 20)
})

test('normalizes the cloud endpoint and rejects insecure remote URLs', () => {
  assert.equal(
    normalizeSettings({
      ...DEFAULT_SETTINGS,
      cloudApiUrl: 'https://localhost:7065/swagger/index.html'
    }).cloudApiUrl,
    'https://localhost:7065'
  )
  assert.throws(
    () =>
      normalizeSettings({
        ...DEFAULT_SETTINGS,
        cloudApiUrl: 'http://api.rockfall.example'
      }),
    /must use HTTPS/
  )
})

test('normalizes valid signature overrides and rejects invalid values', () => {
  assert.deepEqual(
    normalizeSettings({
      ...DEFAULT_SETTINGS,
      signatureOverrides: {
        'agricium-ore': 4_150,
        'riccite-ore': 4_850
      }
    }).signatureOverrides,
    {
      'agricium-ore': 4_150,
      'riccite-ore': 4_850
    }
  )

  assert.throws(
    () =>
      normalizeSettings({
        ...DEFAULT_SETTINGS,
        signatureOverrides: { 'agricium-ore': 4_150.5 }
      }),
    /positive whole numbers/
  )
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

test('preserves newer-version opacity while adding signature override settings', () => {
  const loaded = parsePersistedSettings({
    ...DEFAULT_SETTINGS,
    settingsVersion: SETTINGS_VERSION - 1,
    opacity: 0.72
  })

  assert.equal(loaded.settings.opacity, 0.72)
  assert.deepEqual(loaded.settings.signatureOverrides, {})
  assert.equal(loaded.needsSave, true)
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
