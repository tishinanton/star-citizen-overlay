import assert from 'node:assert/strict'
import test from 'node:test'

import type { BlueprintDetail } from '../shared/contracts'
import type { BlueprintDataResult } from './blueprint-data'
import { applyBlueprintNewMarkers } from './blueprint-newness'

test('applies backend new markers to summaries and details by case-sensitive ID', () => {
  const upper = blueprint('Case-Sensitive-ID')
  const lower = blueprint('case-sensitive-id')
  const result: BlueprintDataResult = {
    catalog: {
      blueprints: [upper, lower],
      icons: {},
      state: 'game',
      message: 'Installed blueprints.',
      updatedAt: '2026-08-07T00:00:00.000Z'
    },
    details: { [upper.id]: upper, [lower.id]: lower },
    gameVersion: '4.9.187.47267-LIVE',
    warnings: []
  }

  const marked = applyBlueprintNewMarkers(result, [{ id: upper.id, isNew: true }])

  assert.equal(marked.catalog.blueprints[0].isNew, true)
  assert.equal(marked.catalog.blueprints[1].isNew, false)
  assert.equal(marked.details[upper.id].isNew, true)
  assert.equal(marked.details[lower.id].isNew, false)
  assert.equal(result.catalog.blueprints[0].isNew, false)
})

function blueprint(id: string): BlueprintDetail {
  return {
    id,
    key: id,
    isNew: false,
    outputName: id,
    outputClass: id,
    outputType: 'Misc',
    outputTypeLabel: 'Misc',
    outputGrade: null,
    outputDescription: null,
    outputManufacturer: null,
    outputStats: [],
    craftTimeSeconds: 60,
    craftTimeLabel: '1 minute',
    availableByDefault: false,
    ingredientCount: 0,
    unlockingMissionCount: 0,
    ingredients: [],
    requirementGroups: [],
    unlockingMissions: [],
    gameVersion: '4.9.187.47267-LIVE',
    imageKey: null,
    renderAsset: null,
    webUrl: null
  }
}
