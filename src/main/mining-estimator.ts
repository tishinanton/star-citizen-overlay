/**
 * Shared, testable scoring pipeline for user-selected mining quality targets.
 *
 * Both the installed-game-data pipeline (`mining-locations.ts`'s
 * `buildLocalMiningLocations`, driven by `MiningCatalog` quantization bands) and
 * the Star Citizen Wiki fallback pipeline (`parseMiningLocationRecommendations`)
 * route through this module so there is exactly one implementation of the
 * threshold-probability math and the group/area combination math.
 */
import { HIGH_QUALITY_THRESHOLD } from '../shared/contracts'

export interface QualityDistributionLike {
  min: number
  max: number
  mean: number | null
  stdDev: number | null
}

export interface QuantizationBandLike {
  start: number
  end: number
  mappedValue: number
}

export interface QuantizedValueProbability {
  quality: number
  probability: number
}

export interface IndependentQuantizationDistribution {
  rockSpawnProbability: number
  quantizationProbabilities: readonly QuantizedValueProbability[]
}

export function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value))
}

// Abramowitz and Stegun's approximation keeps the quality estimate dependency-free.
export function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value) / Math.sqrt(2)
  const t = 1 / (1 + 0.3275911 * x)
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)

  return 0.5 * (1 + sign * erf)
}

/**
 * Raw-threshold estimator: the probability that a value drawn from the
 * (truncated normal, or uniform when no mean/stddev is known) distribution
 * over `[qualityMin, qualityMax]` is at or above `threshold`. This is the only
 * estimator available when no quantization bands exist (the Wiki fallback
 * path never provides them).
 */
export function estimateHighQualityProbability(
  qualityMin: number,
  qualityMax: number,
  qualityMean: number | null,
  qualityStdDev: number | null,
  threshold = HIGH_QUALITY_THRESHOLD
): number {
  if (
    !Number.isFinite(qualityMin) ||
    !Number.isFinite(qualityMax) ||
    qualityMax < qualityMin ||
    !Number.isFinite(threshold)
  ) {
    return 0
  }
  if (qualityMax < threshold) return 0
  if (qualityMin >= threshold) return 1

  if (
    qualityMean === null ||
    qualityStdDev === null ||
    !Number.isFinite(qualityMean) ||
    !Number.isFinite(qualityStdDev) ||
    qualityStdDev <= 0
  ) {
    return clampProbability((qualityMax - threshold) / (qualityMax - qualityMin))
  }

  const lowerCdf = normalCdf((qualityMin - qualityMean) / qualityStdDev)
  const upperCdf = normalCdf((qualityMax - qualityMean) / qualityStdDev)
  const thresholdCdf = normalCdf((threshold - qualityMean) / qualityStdDev)
  const rangeProbability = upperCdf - lowerCdf

  if (rangeProbability <= Number.EPSILON) {
    return clampProbability((qualityMax - threshold) / (qualityMax - qualityMin))
  }

  return clampProbability((upperCdf - thresholdCdf) / rangeProbability)
}

function bandMass(distribution: QualityDistributionLike, lo: number, hi: number): number {
  if (hi <= lo) return 0
  const { mean, stdDev } = distribution
  if (
    mean === null ||
    stdDev === null ||
    !Number.isFinite(mean) ||
    !Number.isFinite(stdDev) ||
    stdDev <= 0
  ) {
    const span = distribution.max - distribution.min
    if (span <= 0) return lo <= distribution.min && hi >= distribution.min ? 1 : 0
    return (hi - lo) / span
  }
  return normalCdf((hi - mean) / stdDev) - normalCdf((lo - mean) / stdDev)
}

/**
 * Quantization-aware estimator: integrates the effective distribution over
 * `[qualityMin, qualityMax]` against the material's raw quantization bands,
 * summing the mass of every band whose `mappedValue >= threshold` and
 * renormalizing against the total mass actually covered by bands (bands need
 * not tile the full effective range). Falls back to the raw estimator when no
 * bands are supplied, or when the bands carry no usable mass in range (e.g.
 * every band falls entirely outside `[qualityMin, qualityMax]`).
 *
 * Assumptions: the caller's `bands` are treated as disjoint (non-overlapping)
 * - overlapping bands would double-count mass in the overlap. `distribution`
 * is expected to already be the *effective* quality range/mean/stdDev (i.e.
 * any material location-quality override and `qualityScale` have already
 * been folded in by the caller); this function does not know about or
 * reapply `curveExponent` - that shaping is intentionally left out of this
 * probability estimate.
 */
export function estimateQuantizedThresholdProbability(
  bands: readonly QuantizationBandLike[],
  distribution: QualityDistributionLike,
  threshold = HIGH_QUALITY_THRESHOLD
): number {
  const {
    min: qualityMin,
    max: qualityMax,
    mean: qualityMean,
    stdDev: qualityStdDev
  } = distribution
  if (bands.length === 0) {
    return estimateHighQualityProbability(
      qualityMin,
      qualityMax,
      qualityMean,
      qualityStdDev,
      threshold
    )
  }
  if (
    !Number.isFinite(qualityMin) ||
    !Number.isFinite(qualityMax) ||
    qualityMax < qualityMin ||
    !Number.isFinite(threshold)
  ) {
    return 0
  }

  let totalMass = 0
  let highMass = 0
  for (const band of bands) {
    const lo = Math.max(band.start, qualityMin)
    const hi = Math.min(band.end, qualityMax)
    if (hi <= lo) continue
    const mass = bandMass(distribution, lo, hi)
    totalMass += mass
    if (band.mappedValue >= threshold) highMass += mass
  }

  if (totalMass <= Number.EPSILON) {
    return estimateHighQualityProbability(
      qualityMin,
      qualityMax,
      qualityMean,
      qualityStdDev,
      threshold
    )
  }

  return clampProbability(highMass / totalMass)
}

export function estimateQuantizedValueProbabilities(
  bands: readonly QuantizationBandLike[],
  distribution: QualityDistributionLike
): QuantizedValueProbability[] {
  if (bands.length === 0) return []

  const massByQuality = new Map<number, number>()
  let totalMass = 0
  for (const band of bands) {
    const lo = Math.max(band.start, distribution.min)
    const hi = Math.min(band.end, distribution.max)
    if (hi <= lo) continue

    const mass = bandMass(distribution, lo, hi)
    if (mass <= 0) continue
    totalMass += mass
    massByQuality.set(band.mappedValue, (massByQuality.get(band.mappedValue) ?? 0) + mass)
  }

  if (totalMass <= Number.EPSILON) return []
  return [...massByQuality]
    .map(([quality, mass]) => ({
      quality,
      probability: clampProbability(mass / totalMass)
    }))
    .sort((left, right) => left.quality - right.quality)
}

function quantizedTailProbability(
  probabilities: readonly QuantizedValueProbability[],
  minimumQuality: number
): number {
  const total = probabilities.reduce((sum, entry) => sum + entry.probability, 0)
  if (total <= Number.EPSILON) return 0
  const tail = probabilities.reduce(
    (sum, entry) => sum + (entry.quality >= minimumQuality ? entry.probability : 0),
    0
  )
  return clampProbability(tail / total)
}

function sortedQuantizedQualities(
  distributions: readonly (readonly QuantizedValueProbability[])[]
): number[] {
  return [
    ...new Set(distributions.flatMap((distribution) => distribution.map((entry) => entry.quality)))
  ].sort((left, right) => left - right)
}

/**
 * Produces the conditional distribution of the best quantized result when
 * several independent spawn events can each yield the target material.
 */
export function combineIndependentQuantizationProbabilities(
  distributions: readonly IndependentQuantizationDistribution[]
): QuantizedValueProbability[] {
  const active = distributions.filter(
    (distribution) => distribution.rockSpawnProbability > Number.EPSILON
  )
  if (
    active.length === 0 ||
    active.some((distribution) => distribution.quantizationProbabilities.length === 0)
  ) {
    return []
  }

  const qualities = sortedQuantizedQualities(
    active.map((distribution) => distribution.quantizationProbabilities)
  )
  const rockSpawnProbability =
    1 -
    active.reduce(
      (noRock, distribution) => noRock * (1 - clampProbability(distribution.rockSpawnProbability)),
      1
    )
  if (qualities.length === 0 || rockSpawnProbability <= Number.EPSILON) return []

  const tails = qualities.map(
    (quality) =>
      1 -
      active.reduce((noResultAtOrAbove, distribution) => {
        const eventProbability =
          clampProbability(distribution.rockSpawnProbability) *
          quantizedTailProbability(distribution.quantizationProbabilities, quality)
        return noResultAtOrAbove * (1 - clampProbability(eventProbability))
      }, 1)
  )

  return qualities.map((quality, index) => ({
    quality,
    probability: clampProbability((tails[index] - (tails[index + 1] ?? 0)) / rockSpawnProbability)
  }))
}

export interface AreaCandidate {
  name: string | null
  globalModifier: number
}

export interface ScoredContribution {
  groupName: string
  groupProbability: number | null
  relativeProbability: number | null
  highQualityProbability: number
  areaModifiers: ReadonlyMap<string, number>
}

export interface ProbabilityScoredContribution extends ScoredContribution {
  quantizationProbabilities: readonly QuantizedValueProbability[]
}

export interface MiningProbabilityBreakdown {
  rockSpawnProbability: number | null
  qualityThresholdProbability: number | null
  combinedProbability: number | null
  quantizationProbabilities: QuantizedValueProbability[]
}

function buildGroupQuantizationProbabilities(
  groupProbability: number,
  groupRockProbability: number,
  entries: readonly {
    spawnWeight: number
    quantizationProbabilities: readonly QuantizedValueProbability[]
  }[]
): QuantizedValueProbability[] {
  const active = entries.filter((entry) => entry.spawnWeight > Number.EPSILON)
  if (
    active.length === 0 ||
    groupRockProbability <= Number.EPSILON ||
    active.some((entry) => entry.quantizationProbabilities.length === 0)
  ) {
    return []
  }

  const qualities = sortedQuantizedQualities(active.map((entry) => entry.quantizationProbabilities))
  const tails = qualities.map(
    (quality) =>
      groupProbability *
      clampProbability(
        active.reduce(
          (sum, entry) =>
            sum +
            entry.spawnWeight * quantizedTailProbability(entry.quantizationProbabilities, quality),
          0
        )
      )
  )

  return qualities.map((quality, index) => ({
    quality,
    probability: clampProbability((tails[index] - (tails[index + 1] ?? 0)) / groupRockProbability)
  }))
}

export function scoreProbabilityBreakdown(
  contributions: readonly ProbabilityScoredContribution[],
  area: AreaCandidate
): MiningProbabilityBreakdown {
  const groups = new Map<
    string,
    {
      groupProbability: number
      entries: Array<{
        spawnWeight: number
        qualityProbability: number
        quantizationProbabilities: readonly QuantizedValueProbability[]
      }>
    }
  >()

  for (const contribution of contributions) {
    if (contribution.groupProbability === null || contribution.relativeProbability === null) {
      continue
    }
    const areaModifier =
      area.name === null ? 1 : (contribution.areaModifiers.get(area.name) ?? area.globalModifier)
    const current = groups.get(contribution.groupName) ?? {
      groupProbability: 0,
      entries: []
    }
    current.groupProbability = Math.max(current.groupProbability, contribution.groupProbability)
    current.entries.push({
      spawnWeight: contribution.relativeProbability * Math.max(0, areaModifier),
      qualityProbability: contribution.highQualityProbability,
      quantizationProbabilities: contribution.quantizationProbabilities
    })
    groups.set(contribution.groupName, current)
  }

  if (groups.size === 0) {
    return {
      rockSpawnProbability: null,
      qualityThresholdProbability: null,
      combinedProbability: null,
      quantizationProbabilities: []
    }
  }

  let noRockProbability = 1
  let noThresholdProbability = 1
  let hasCompleteQuantization = true
  const quantizationDistributions: IndependentQuantizationDistribution[] = []

  for (const group of groups.values()) {
    const totalSpawnWeight = group.entries.reduce((sum, entry) => sum + entry.spawnWeight, 0)
    const groupRockProbability = group.groupProbability * clampProbability(totalSpawnWeight)
    const groupThresholdProbability =
      group.groupProbability *
      clampProbability(
        group.entries.reduce((sum, entry) => sum + entry.spawnWeight * entry.qualityProbability, 0)
      )
    noRockProbability *= 1 - clampProbability(groupRockProbability)
    noThresholdProbability *= 1 - clampProbability(groupThresholdProbability)
    if (totalSpawnWeight <= Number.EPSILON || groupRockProbability <= 0) continue

    const groupQuantizationProbabilities = buildGroupQuantizationProbabilities(
      group.groupProbability,
      groupRockProbability,
      group.entries
    )
    if (groupQuantizationProbabilities.length === 0) {
      hasCompleteQuantization = false
    } else {
      quantizationDistributions.push({
        rockSpawnProbability: groupRockProbability,
        quantizationProbabilities: groupQuantizationProbabilities
      })
    }
  }

  const rockSpawnProbability = 1 - noRockProbability
  const combinedProbability = 1 - noThresholdProbability
  const qualityThresholdProbability =
    rockSpawnProbability > Number.EPSILON
      ? clampProbability(combinedProbability / rockSpawnProbability)
      : null
  const quantizationProbabilities = hasCompleteQuantization
    ? combineIndependentQuantizationProbabilities(quantizationDistributions)
    : []

  return {
    rockSpawnProbability,
    qualityThresholdProbability,
    combinedProbability,
    quantizationProbabilities
  }
}

/**
 * Combines every contribution into a single threshold chance for one candidate
 * area: for each spawn group, take the strongest group probability seen and
 * sum relative-probability-weighted, area-modified, per-contribution
 * high-quality chances; then combine groups as independent "at least one
 * group rolls high quality" events. Mirrors the pre-existing Wiki-only
 * combination logic so both pipelines share one formula.
 */
export function scoreContributions(
  contributions: readonly ScoredContribution[],
  area: AreaCandidate
): number | null {
  return scoreProbabilityBreakdown(
    contributions.map((contribution) => ({
      ...contribution,
      quantizationProbabilities: []
    })),
    area
  ).combinedProbability
}
