import type { MiningLocationRecommendation } from '../../../shared/contracts'

const probabilityFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1
})

export function formatMiningProbability(value: number): string {
  const percent = value * 100
  if (percent > 0 && percent < 0.1) return '<0.1%'
  return `${probabilityFormatter.format(percent)}%`
}

export function formatMiningSiteName(location: MiningLocationRecommendation): string {
  return location.area ? `${location.name} · ${location.area}` : location.name
}
