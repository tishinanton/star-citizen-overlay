import assert from 'node:assert/strict'
import test from 'node:test'

import type { MiningLocationRecommendation } from '../../../shared/contracts'
import {
  formatMiningProbability,
  formatMiningProbabilityBreakdown,
  formatMiningQualityRange
} from './mining-location-format'

const location: MiningLocationRecommendation = {
  id: 'location-test',
  name: 'Test Site',
  area: null,
  system: 'Stanton System',
  type: 'Moon',
  parentName: 'Stanton',
  rockSpawnProbability: 0.25,
  qualityThresholdProbability: 0.5,
  combinedProbability: 0.125,
  quantizationProbabilities: [],
  minQuality: 245,
  maxQuality: 1_000,
  minComposition: null,
  maxComposition: 75,
  identitySource: 'wiki',
  sourceUrl: 'https://example.com/location-test'
}

test('formats an estimated mining probability as a percentage', () => {
  assert.equal(formatMiningProbability(location.combinedProbability ?? 0), '12.5%')
  assert.equal(formatMiningProbability(0.0005), '0.05%')
  assert.equal(formatMiningProbability(0), '0.00%')
})

test('formats complete, legacy, and unavailable mining probability breakdowns', () => {
  assert.equal(
    formatMiningProbabilityBreakdown(location, 500),
    'Find 25.0% · ≥500 50.0% · Both 12.5%'
  )
  assert.equal(
    formatMiningProbabilityBreakdown(
      { ...location, rockSpawnProbability: null, qualityThresholdProbability: null },
      500
    ),
    '≥500 combined 12.5% · breakdown unavailable'
  )
  assert.equal(
    formatMiningProbabilityBreakdown({ ...location, combinedProbability: null }, 500),
    '≥500: unavailable'
  )
})

test('formats numeric mining quality ranges and legacy cache fallbacks', () => {
  assert.equal(formatMiningQualityRange(location), '245–1,000')
  assert.equal(formatMiningQualityRange({ ...location, minQuality: 501, maxQuality: 501 }), '501')
  assert.equal(
    formatMiningQualityRange({ ...location, minQuality: null, maxQuality: 789 }),
    'Up to 789'
  )
})
