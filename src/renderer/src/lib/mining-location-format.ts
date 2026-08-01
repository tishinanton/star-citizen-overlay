import type { MiningLocationRecommendation } from '../../../shared/contracts'

const probabilityFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1
})
const preciseProbabilityFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2
})
const qualityFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1
})

export function formatMiningProbability(value: number): string {
  const percent = value * 100
  if (percent > 0 && percent < 0.01) return '<0.01%'
  if (percent < 10) return `${preciseProbabilityFormatter.format(percent)}%`
  return `${probabilityFormatter.format(percent)}%`
}

export function formatMiningProbabilityBreakdown(
  location: MiningLocationRecommendation,
  qualityThreshold: number
): string {
  if (location.combinedProbability === null) return `≥${qualityThreshold}: unavailable`
  if (
    location.rockSpawnProbability === null ||
    location.qualityThresholdProbability === null
  ) {
    return `≥${qualityThreshold} combined ${formatMiningProbability(location.combinedProbability)} · breakdown unavailable`
  }

  return `Find ${formatMiningProbability(location.rockSpawnProbability)} · ≥${qualityThreshold} ${formatMiningProbability(location.qualityThresholdProbability)} · Both ${formatMiningProbability(location.combinedProbability)}`
}

export function formatMiningSiteName(location: MiningLocationRecommendation): string {
  return location.area ? `${location.name} · ${location.area}` : location.name
}

export function formatMiningQualityRange(location: MiningLocationRecommendation): string {
  const maximum = qualityFormatter.format(location.maxQuality)
  if (location.minQuality === null) return `Up to ${maximum}`

  const minimum = qualityFormatter.format(location.minQuality)
  return minimum === maximum ? maximum : `${minimum}–${maximum}`
}

/**
 * Formats the material's share of an entity's mass as a range (min–max), mirroring
 * `formatMiningQualityRange`. Falls back to a ceiling-only phrasing when no minimum is known
 * (legacy cached rows, or a source that never reported one), and to an "unknown" phrasing when
 * neither bound is available.
 */
export function formatMiningCompositionRange(location: MiningLocationRecommendation): string {
  if (location.maxComposition === null) return 'Unknown'

  const maximum = qualityFormatter.format(location.maxComposition)
  if (location.minComposition === null) return `Up to ${maximum}%`

  const minimum = qualityFormatter.format(location.minComposition)
  return minimum === maximum ? `${maximum}%` : `${minimum}–${maximum}%`
}
