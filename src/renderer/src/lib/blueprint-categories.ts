import type { BlueprintSummary } from '../../../shared/contracts'

type BlueprintCategorySource = Pick<BlueprintSummary, 'outputType' | 'outputTypeLabel'>

export interface BlueprintCategoryOption {
  value: string
  label: string
}

interface BlueprintCategoryAssignment {
  readonly category: string
  readonly subcategory: string
}

const categoryCollator = new Intl.Collator('en-US', {
  numeric: true,
  sensitivity: 'base'
})

const categoriesByOutputType = new Map<string, BlueprintCategoryAssignment>([
  ['Char_Armor_Arms', { category: 'Armor', subcategory: 'Arms' }],
  ['Char_Armor_Torso', { category: 'Armor', subcategory: 'Core' }],
  ['Char_Armor_Legs', { category: 'Armor', subcategory: 'Legs' }],
  ['Char_Armor_Backpack', { category: 'Armor', subcategory: 'Backpacks' }],
  ['SalvageHead', { category: 'Vehicles', subcategory: 'Salvage' }],
  ['TractorBeam', { category: 'Vehicles', subcategory: 'Salvage' }],
  ['WeaponGun', { category: 'Vehicles', subcategory: 'Weapons' }],
  ['Cargo', { category: 'Vehicles', subcategory: 'Cargo' }],
  ['Cooler', { category: 'Vehicles', subcategory: 'Coolers' }],
  ['DockingCollar', { category: 'Vehicles', subcategory: 'Docking Collars' }],
  ['Char_Armor_Helmet', { category: 'Armor', subcategory: 'Helmets' }],
  ['Char_Clothing_Torso_1', { category: 'Clothing', subcategory: 'Jackets' }],
  ['WeaponAttachment', { category: 'Ammo', subcategory: 'Ammo' }],
  ['WeaponMining', { category: 'Vehicles', subcategory: 'Mining' }],
  ['Misc', { category: 'Misc', subcategory: 'Misc' }],
  ['Char_Clothing_Legs', { category: 'Clothing', subcategory: 'Legwear' }],
  ['PowerPlant', { category: 'Vehicles', subcategory: 'Powerplants' }],
  ['QuantumDrive', { category: 'Vehicles', subcategory: 'Quantumdrives' }],
  ['Radar', { category: 'Vehicles', subcategory: 'Radars' }],
  ['SalvageModifier', { category: 'Vehicles', subcategory: 'Salvage' }],
  ['Shield', { category: 'Vehicles', subcategory: 'Shields' }],
  ['Char_Clothing_Torso_0', { category: 'Clothing', subcategory: 'Shirts' }],
  ['Char_Clothing_Feet', { category: 'Clothing', subcategory: 'Footwear' }],
  ['Char_Armor_Undersuit', { category: 'Armor', subcategory: 'Undersuits' }]
])

const personalWeaponSubcategories = new Map<string, string>([
  ['Pistol', 'Sidearm'],
  ['Rifle', 'Primary'],
  ['Shotgun', 'Primary'],
  ['SMG', 'Primary'],
  ['Sniper', 'Primary'],
  ['Weapon Personal', 'Special']
])

export function getBlueprintCategoryOptions(
  blueprints: readonly BlueprintCategorySource[]
): BlueprintCategoryOption[] {
  return buildOptions(blueprints.map((blueprint) => getCategoryAssignment(blueprint).category))
}

export function getBlueprintSubcategoryOptions(
  blueprints: readonly BlueprintCategorySource[],
  category: string
): BlueprintCategoryOption[] {
  if (!category) return []

  const subcategories: string[] = []
  for (const blueprint of blueprints) {
    const assignment = getCategoryAssignment(blueprint)
    if (assignment.category === category) subcategories.push(assignment.subcategory)
  }
  return buildOptions(subcategories)
}

function buildOptions(values: readonly string[]): BlueprintCategoryOption[] {
  return [...new Set(values)]
    .sort((left, right) => categoryCollator.compare(left, right))
    .map((value) => ({ value, label: value }))
}

function getCategoryAssignment(blueprint: BlueprintCategorySource): BlueprintCategoryAssignment {
  if (blueprint.outputType === 'WeaponPersonal') {
    return {
      category: 'Weapons',
      subcategory: personalWeaponSubcategories.get(blueprint.outputTypeLabel) ?? 'Special'
    }
  }

  return (
    categoriesByOutputType.get(blueprint.outputType) ?? {
      category: 'Misc',
      subcategory: blueprint.outputTypeLabel
    }
  )
}

export function matchesBlueprintCategory(
  blueprint: BlueprintCategorySource,
  category: string,
  subcategory = ''
): boolean {
  const assignment = getCategoryAssignment(blueprint)
  return (
    (category === '' || assignment.category === category) &&
    (subcategory === '' || assignment.subcategory === subcategory)
  )
}
