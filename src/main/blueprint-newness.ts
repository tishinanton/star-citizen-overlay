import type { BlueprintDetail, BlueprintSummary } from '../shared/contracts'
import type { BlueprintDataResult } from './blueprint-data'
import type { CloudBlueprintMarker } from './cloud-api'

export function applyBlueprintNewMarkers(
  result: BlueprintDataResult,
  markers: readonly CloudBlueprintMarker[]
): BlueprintDataResult {
  const isNewById = new Map(markers.map((marker) => [marker.id, marker.isNew]))
  const applyMarker = <T extends BlueprintSummary | BlueprintDetail>(blueprint: T): T => ({
    ...blueprint,
    isNew: isNewById.get(blueprint.id) === true
  })

  return {
    ...result,
    catalog: {
      ...result.catalog,
      blueprints: result.catalog.blueprints.map(applyMarker)
    },
    details: Object.fromEntries(
      Object.entries(result.details).map(([id, blueprint]) => [id, applyMarker(blueprint)])
    )
  }
}
