import type { MiningMaterial } from '../../../shared/contracts'

export function pinSelectedMaterials(
  materials: readonly MiningMaterial[],
  selectedMaterialIds: readonly string[],
  matches: (material: MiningMaterial) => boolean
): MiningMaterial[] {
  const materialsById = new Map(materials.map((material) => [material.id, material]))
  const pinnedIds = new Set<string>()
  const pinned: MiningMaterial[] = []

  for (const id of selectedMaterialIds) {
    const material = materialsById.get(id)
    if (material && !pinnedIds.has(id)) {
      pinned.push(material)
      pinnedIds.add(id)
    }
  }

  return [
    ...pinned,
    ...materials.filter((material) => !pinnedIds.has(material.id) && matches(material))
  ]
}
