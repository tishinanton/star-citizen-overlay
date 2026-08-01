import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampProbability,
  estimateHighQualityProbability,
  estimateQuantizedThresholdProbability,
  estimateQuantizedValueProbabilities,
  scoreProbabilityBreakdown,
  scoreContributions,
  type QualityDistributionLike,
  type QuantizationBandLike
} from './mining-estimator'

test('clamps probabilities to the unit interval', () => {
  assert.equal(clampProbability(-0.2), 0)
  assert.equal(clampProbability(1.4), 1)
  assert.equal(clampProbability(0.42), 0.42)
})

test('falls back to the raw threshold estimator when no quantization bands exist', () => {
  const distribution: QualityDistributionLike = { min: 0, max: 1_000, mean: 500, stdDev: 200 }
  const quantized = estimateQuantizedThresholdProbability([], distribution, 500)
  const raw = estimateHighQualityProbability(
    distribution.min,
    distribution.max,
    distribution.mean,
    distribution.stdDev,
    500
  )
  assert.equal(quantized, raw)
  assert.ok(quantized > 0 && quantized < 1)
})

test('integrates mass only over bands whose mapped value clears the threshold', () => {
  // Uniform distribution (no mean/stddev) over [0, 1000], four equal-width continuous bands, two
  // of which map at or above the 500 threshold: the quantization-aware chance should be exactly
  // 0.5, matching the fraction of *bands* covering high-quality outcomes (not the raw span
  // fraction, which would coincidentally also be 0.5 here but for the wrong reason).
  const distribution: QualityDistributionLike = { min: 0, max: 1_000, mean: null, stdDev: null }
  const bands: QuantizationBandLike[] = [
    { start: 0, end: 250, mappedValue: 200 },
    { start: 250, end: 500, mappedValue: 400 },
    { start: 500, end: 750, mappedValue: 600 },
    { start: 750, end: 1_000, mappedValue: 900 }
  ]
  const probability = estimateQuantizedThresholdProbability(bands, distribution, 500)
  assert.ok(Math.abs(probability - 0.5) < 1e-9)
})

test('renormalizes when bands only partially cover the effective quality range', () => {
  // The effective range is narrowed to [300, 1000] (e.g. a location override raised the floor),
  // but the bands still span the material's full raw range. Only the portion of each band that
  // intersects [300, 1000] should count, and the result should renormalize against that reduced
  // total mass rather than against the material's raw full-range mass.
  const distribution: QualityDistributionLike = { min: 300, max: 1_000, mean: null, stdDev: null }
  const bands: QuantizationBandLike[] = [
    { start: 0, end: 400, mappedValue: 274 }, // intersects [300,400] -> below threshold
    { start: 400, end: 600, mappedValue: 526 }, // fully in range -> at/above threshold
    { start: 600, end: 1_000, mappedValue: 800 } // fully in range -> at/above threshold
  ]
  const probability = estimateQuantizedThresholdProbability(bands, distribution, 500)
  // Mass: [300,400]=100, [400,600]=200 (high), [600,1000]=400 (high). Total=700, high=600.
  const expected = (200 + 400) / (100 + 200 + 400)
  assert.ok(Math.abs(probability - expected) < 1e-9)
})

test('falls back to the raw estimator when every band falls outside the effective range', () => {
  const distribution: QualityDistributionLike = { min: 900, max: 1_000, mean: null, stdDev: null }
  const bands: QuantizationBandLike[] = [
    { start: 0, end: 399, mappedValue: 274 },
    { start: 400, end: 599, mappedValue: 526 }
  ]
  const probability = estimateQuantizedThresholdProbability(bands, distribution, 500)
  const raw = estimateHighQualityProbability(900, 1_000, null, null, 500)
  assert.equal(probability, raw)
  assert.equal(probability, 1)
})

test('treats a band entirely below or above the threshold as all-or-nothing mass', () => {
  const distribution: QualityDistributionLike = { min: 0, max: 1_000, mean: null, stdDev: null }
  const belowOnly: QuantizationBandLike[] = [{ start: 0, end: 1_000, mappedValue: 100 }]
  assert.equal(estimateQuantizedThresholdProbability(belowOnly, distribution, 500), 0)

  const aboveOnly: QuantizationBandLike[] = [{ start: 0, end: 1_000, mappedValue: 900 }]
  assert.equal(estimateQuantizedThresholdProbability(aboveOnly, distribution, 500), 1)
})

test('integrates truncated-normal mass across bands when mean/stdDev are known', () => {
  const distribution: QualityDistributionLike = { min: 0, max: 1_000, mean: 500, stdDev: 150 }
  const bands: QuantizationBandLike[] = [
    { start: 0, end: 499, mappedValue: 250 },
    { start: 500, end: 1_000, mappedValue: 750 }
  ]
  const probability = estimateQuantizedThresholdProbability(bands, distribution, 500)
  // Symmetric normal centered at the band boundary: each side carries ~50% of the mass, and only
  // the upper band clears the threshold.
  assert.ok(Math.abs(probability - 0.5) < 0.01)
})

test('returns a normalized probability for every quantized quality value', () => {
  const distribution: QualityDistributionLike = { min: 0, max: 1_000, mean: null, stdDev: null }
  const probabilities = estimateQuantizedValueProbabilities(
    [
      { start: 0, end: 400, mappedValue: 274 },
      { start: 400, end: 600, mappedValue: 526 },
      { start: 600, end: 1_000, mappedValue: 800 }
    ],
    distribution
  )

  assert.deepEqual(probabilities, [
    { quality: 274, probability: 0.4 },
    { quality: 526, probability: 0.2 },
    { quality: 800, probability: 0.4 }
  ])
})

test('combines spawn groups and area modifiers into a probability breakdown', () => {
  const contributions = [
    {
      groupName: 'Ship_Mineables',
      groupProbability: 0.5,
      relativeProbability: 0.4,
      highQualityProbability: 0.6,
      areaModifiers: new Map()
    },
    {
      groupName: 'Ship_Mineables',
      groupProbability: 0.5,
      relativeProbability: 0.6,
      highQualityProbability: 0.2,
      areaModifiers: new Map()
    },
    {
      groupName: 'FPS_Mineables',
      groupProbability: 0.25,
      relativeProbability: 1,
      highQualityProbability: 0.8,
      areaModifiers: new Map([['Cave A', 1.5]])
    }
  ]
  const probability = scoreContributions(contributions, { name: 'Cave A', globalModifier: 1 })
  const breakdown = scoreProbabilityBreakdown(
    contributions.map((contribution) => ({
      ...contribution,
      quantizationProbabilities: []
    })),
    { name: 'Cave A', globalModifier: 1 }
  )

  assert.ok(probability !== null)
  // Ship target chance: 0.5 * (0.4 + 0.6) = 0.5
  // FPS target chance: 0.25 * clamp(1 * 1.5) = 0.25
  // Find chance: 1 - (1-0.5)*(1-0.25) = 0.625
  // Ship qualifying chance: 0.5 * (0.4*0.6 + 0.6*0.2) = 0.18
  // FPS qualifying chance: 0.25 * clamp(1*1.5*0.8) = 0.25
  // Combined: 1 - (1-0.18)*(1-0.25) = 0.385
  // Conditional quality: 0.385 / 0.625 = 0.616
  assert.ok(Math.abs((breakdown.rockSpawnProbability ?? 0) - 0.625) < 1e-9)
  assert.ok(Math.abs((breakdown.qualityThresholdProbability ?? 0) - 0.616) < 1e-9)
  assert.ok(Math.abs((probability ?? 0) - 0.385) < 1e-9)
  assert.equal(breakdown.combinedProbability, probability)
})

test('unions each independent group qualifying event before deriving the conditional chance', () => {
  const breakdown = scoreProbabilityBreakdown(
    ['Ship_Mineables', 'FPS_Mineables'].map((groupName) => ({
      groupName,
      groupProbability: 0.5,
      relativeProbability: 1,
      highQualityProbability: 0.5,
      areaModifiers: new Map(),
      quantizationProbabilities: [
        { quality: 250, probability: 0.5 },
        { quality: 750, probability: 0.5 }
      ]
    })),
    { name: null, globalModifier: 1 }
  )

  assert.ok(Math.abs((breakdown.rockSpawnProbability ?? 0) - 0.75) < 1e-9)
  assert.ok(Math.abs((breakdown.combinedProbability ?? 0) - 0.4375) < 1e-9)
  assert.ok(Math.abs((breakdown.qualityThresholdProbability ?? 0) - 0.4375 / 0.75) < 1e-9)
  assert.ok(
    Math.abs(
      breakdown.quantizationProbabilities
        .filter((entry) => entry.quality >= 500)
        .reduce((sum, entry) => sum + entry.probability, 0) -
        (breakdown.qualityThresholdProbability ?? 0)
    ) < 1e-9
  )
  assert.ok(
    Math.abs(
      breakdown.quantizationProbabilities.reduce((sum, entry) => sum + entry.probability, 0) - 1
    ) < 1e-9
  )
})

test('returns null probabilities when every contribution lacks spawn inputs', () => {
  const breakdown = scoreProbabilityBreakdown(
    [
      {
        groupName: 'Unknown',
        groupProbability: null,
        relativeProbability: null,
        highQualityProbability: 0.5,
        areaModifiers: new Map(),
        quantizationProbabilities: []
      }
    ],
    { name: null, globalModifier: 1 }
  )

  assert.equal(breakdown.rockSpawnProbability, null)
  assert.equal(breakdown.qualityThresholdProbability, null)
  assert.equal(breakdown.combinedProbability, null)
})

test('returns null when every contribution is missing group or relative probability', () => {
  const probability = scoreContributions(
    [
      {
        groupName: 'Unknown',
        groupProbability: null,
        relativeProbability: null,
        highQualityProbability: 0.5,
        areaModifiers: new Map()
      }
    ],
    { name: null, globalModifier: 1 }
  )
  assert.equal(probability, null)
})
