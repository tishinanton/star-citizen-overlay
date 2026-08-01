import assert from 'node:assert/strict'
import test from 'node:test'

import type { MiningLocationRecommendation } from '../../../shared/contracts'
import { formatMiningProbability, formatMiningQualityRange } from './mining-location-format'

const location: MiningLocationRecommendation = {
  id: 'location-test',
  name: 'Test Site',
  area: null,
  system: 'Stanton System',
  type: 'Moon',
  parentName: 'Stanton',
  highQualityProbability: 0.125,
  minQuality: 245,
  maxQuality: 1_000,
  maxComposition: 75,
  sourceUrl: 'https://example.com/location-test'
}

test('formats an estimated mining probability as a percentage', () => {
  assert.equal(formatMiningProbability(location.highQualityProbability ?? 0), '12.5%')
  assert.equal(formatMiningProbability(0.0005), '<0.1%')
  assert.equal(formatMiningProbability(0), '0.0%')
})

test('formats numeric mining quality ranges and legacy cache fallbacks', () => {
  assert.equal(formatMiningQualityRange(location), '24.5–100%')
  assert.equal(formatMiningQualityRange({ ...location, minQuality: 501, maxQuality: 501 }), '50.1%')
  assert.equal(
    formatMiningQualityRange({ ...location, minQuality: null, maxQuality: 789 }),
    'Up to 78.9%'
  )
})
