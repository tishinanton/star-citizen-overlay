/**
 * Shared, testable scoring pipeline for mining site "50%+ quality" estimates.
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

/**
 * Combines every contribution into a single 50%+ chance for one candidate
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
  const groups = new Map<string, { groupProbability: number; relativeChance: number }>()

  for (const contribution of contributions) {
    if (contribution.groupProbability === null || contribution.relativeProbability === null) {
      continue
    }
    const areaModifier =
      area.name === null ? 1 : (contribution.areaModifiers.get(area.name) ?? area.globalModifier)
    const current = groups.get(contribution.groupName) ?? {
      groupProbability: 0,
      relativeChance: 0
    }
    current.groupProbability = Math.max(current.groupProbability, contribution.groupProbability)
    current.relativeChance +=
      contribution.relativeProbability * contribution.highQualityProbability * areaModifier
    groups.set(contribution.groupName, current)
  }

  if (groups.size === 0) return null

  let noHighQualityProbability = 1
  for (const group of groups.values()) {
    const groupChance = group.groupProbability * clampProbability(group.relativeChance)
    noHighQualityProbability *= 1 - clampProbability(groupChance)
  }
  return 1 - noHighQualityProbability
}
