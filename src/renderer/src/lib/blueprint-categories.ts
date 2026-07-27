import type { BlueprintSummary } from '../../../shared/contracts'

type BlueprintCategorySource = Pick<BlueprintSummary, 'outputType' | 'outputTypeLabel'>

export interface BlueprintCategoryOption {
  value: string
  label: string
}

const categoryCollator = new Intl.Collator('en-US', {
  numeric: true,
  sensitivity: 'base'
})

export function getBlueprintCategoryOptions(
  blueprints: readonly BlueprintCategorySource[]
): BlueprintCategoryOption[] {
  const categories = new Map<string, BlueprintCategoryOption>()

  for (const blueprint of blueprints) {
    if (categories.has(blueprint.outputType)) continue
    categories.set(blueprint.outputType, {
      value: blueprint.outputType,
      label: blueprint.outputTypeLabel
    })
  }

  return [...categories.values()].sort(
    (left, right) =>
      categoryCollator.compare(left.label, right.label) ||
      categoryCollator.compare(left.value, right.value)
  )
}

export function matchesBlueprintCategory(
  blueprint: BlueprintCategorySource,
  category: string
): boolean {
  return category === '' || blueprint.outputType === category
}
