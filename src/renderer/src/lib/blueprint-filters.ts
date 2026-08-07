import type { BlueprintOwnershipSnapshot, BlueprintSummary } from '../../../shared/contracts'
import { matchesBlueprintCategory } from './blueprint-categories'

export type BlueprintAccessFilter = 'all' | 'mission' | 'default'
export type BlueprintCollectionFilter = 'all' | 'owned' | 'obtainable'
export type BlueprintRecencyFilter = 'all' | 'new'

export interface BlueprintFilterState {
  query: string
  category: string
  subcategory: string
  access: BlueprintAccessFilter
  collection: BlueprintCollectionFilter
  recency: BlueprintRecencyFilter
}

export const DEFAULT_BLUEPRINT_FILTERS: Readonly<BlueprintFilterState> = {
  query: '',
  category: '',
  subcategory: '',
  access: 'all',
  collection: 'all',
  recency: 'all'
}

export function filterBlueprints(
  blueprints: BlueprintSummary[],
  ownership: BlueprintOwnershipSnapshot | null,
  filters: BlueprintFilterState
): BlueprintSummary[] {
  const normalizedQuery = filters.query.trim().toLowerCase()

  return blueprints.filter((blueprint) => {
    const owned = blueprint.availableByDefault || ownership?.records[blueprint.id] !== undefined
    const matchesQuery =
      !normalizedQuery ||
      blueprint.outputName.toLowerCase().includes(normalizedQuery) ||
      blueprint.outputTypeLabel.toLowerCase().includes(normalizedQuery) ||
      blueprint.key.toLowerCase().includes(normalizedQuery) ||
      blueprint.ingredients.some((ingredient) =>
        ingredient.name.toLowerCase().includes(normalizedQuery)
      )
    const matchesAccess =
      filters.access === 'all' ||
      (filters.access === 'default' && blueprint.availableByDefault) ||
      (filters.access === 'mission' &&
        !blueprint.availableByDefault &&
        blueprint.unlockingMissionCount > 0)
    const matchesCollection =
      filters.collection === 'all' ||
      (filters.collection === 'owned' && owned) ||
      (filters.collection === 'obtainable' && !owned && blueprint.unlockingMissionCount > 0)

    return (
      matchesQuery &&
      matchesBlueprintCategory(blueprint, filters.category, filters.subcategory) &&
      matchesAccess &&
      matchesCollection &&
      (filters.recency === 'all' || blueprint.isNew === true)
    )
  })
}

export function hasActiveBlueprintFilters(filters: BlueprintFilterState): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.category !== '' ||
    filters.subcategory !== '' ||
    filters.access !== 'all' ||
    filters.collection !== 'all' ||
    filters.recency !== 'all'
  )
}

export function getBlueprintEmptyState(filters: BlueprintFilterState): {
  title: string
  description: string
  canClear: boolean
} {
  return {
    title: filters.recency === 'new' ? 'No new blueprints match' : 'No matching blueprints',
    description: 'Try another output, material, category, access, collection, or added filter.',
    canClear: hasActiveBlueprintFilters(filters)
  }
}
