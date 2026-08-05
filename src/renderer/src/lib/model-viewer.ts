import {
  Box3,
  BufferGeometry,
  Material,
  Object3D,
  PerspectiveCamera,
  Texture,
  Vector3
} from 'three'

export interface ModelFraming {
  center: Vector3
  distance: number
  minimumDistance: number
  maximumDistance: number
}

const INITIAL_VIEW_DIRECTION = new Vector3(1.25, -1.6, 1.05).normalize()

export function getModelFraming(root: Object3D, verticalFovDegrees: number): ModelFraming {
  const bounds = new Box3().setFromObject(root)
  if (bounds.isEmpty()) throw new Error('The model has no visible bounds.')

  const center = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const extent = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(extent) || extent <= 1e-6) {
    throw new Error('The model has invalid bounds.')
  }

  const halfFov = (verticalFovDegrees * Math.PI) / 360
  const distance = (extent * 0.72) / Math.tan(halfFov)
  return {
    center,
    distance,
    minimumDistance: distance * 0.34,
    maximumDistance: distance * 4
  }
}

export function resetModelCamera(
  camera: PerspectiveCamera,
  framing: ModelFraming,
  target: Vector3
): void {
  target.copy(framing.center)
  camera.position.copy(framing.center).addScaledVector(INITIAL_VIEW_DIRECTION, framing.distance)
  camera.near = Math.max(framing.distance / 1_000, 0.001)
  camera.far = framing.distance * 20
  camera.updateProjectionMatrix()
}

export function disposeModel(root: Object3D): void {
  const textures = new Set<Texture>()
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()

  root.traverse((object) => {
    const candidate = object as Object3D & {
      geometry?: BufferGeometry
      material?: Material | Material[]
    }
    if (candidate.geometry) geometries.add(candidate.geometry)
    const objectMaterials = Array.isArray(candidate.material)
      ? candidate.material
      : candidate.material
        ? [candidate.material]
        : []
    for (const material of objectMaterials) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value)
      }
    }
  })

  for (const texture of textures) texture.dispose()
  for (const material of materials) material.dispose()
  for (const geometry of geometries) geometry.dispose()
}
