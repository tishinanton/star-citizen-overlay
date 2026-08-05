import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Texture,
  Vector3
} from 'three'

import { disposeModel, getModelFraming, resetModelCamera } from './model-viewer'

test('frames models deterministically with bounded zoom distances', () => {
  const root = new Group()
  root.add(new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial()))
  const framing = getModelFraming(root, 36)
  const camera = new PerspectiveCamera(36, 1, 0.1, 1_000)
  const target = new Vector3()

  resetModelCamera(camera, framing, target)

  assert.deepEqual(target.toArray(), [0, 0, 0])
  assert.ok(framing.minimumDistance > 0)
  assert.ok(framing.maximumDistance > framing.distance)
  assert.ok(Math.abs(camera.position.distanceTo(target) - framing.distance) < 1e-8)
})

test('disposes model geometry, materials, and textures once', () => {
  const root = new Group()
  const geometry = new BoxGeometry()
  const texture = new Texture()
  const material = new MeshStandardMaterial({ map: texture })
  root.add(new Mesh(geometry, material), new Mesh(geometry, material))
  let geometryDisposals = 0
  let materialDisposals = 0
  let textureDisposals = 0
  geometry.addEventListener('dispose', () => {
    geometryDisposals += 1
  })
  material.addEventListener('dispose', () => {
    materialDisposals += 1
  })
  texture.addEventListener('dispose', () => {
    textureDisposals += 1
  })

  disposeModel(root)

  assert.equal(geometryDisposals, 1)
  assert.equal(materialDisposals, 1)
  assert.equal(textureDisposals, 1)
})
