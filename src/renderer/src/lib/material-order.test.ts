import assert from 'node:assert/strict'
import test from 'node:test'

import type { MiningMaterial } from '../../../shared/contracts'
import { pinSelectedMaterials } from './material-order'

const materials: MiningMaterial[] = ['a', 'b', 'c', 'd'].map((id, index) => ({
  id,
  commodityId: id,
  name: `Material ${id.toUpperCase()}`,
  displayName: `Material ${id.toUpperCase()}`,
  signature: 100 + index,
  methods: ['Ship'],
  catalogMaterialId: null,
  sourceUrl: 'https://example.com'
}))

test('pins selected materials in selection order even when filters do not match', () => {
  const result = pinSelectedMaterials(materials, ['d', 'b'], (material) =>
    ['a', 'c'].includes(material.id)
  )

  assert.deepEqual(
    result.map((material) => material.id),
    ['d', 'b', 'a', 'c']
  )
  assert.deepEqual(
    materials.map((material) => material.id),
    ['a', 'b', 'c', 'd']
  )
})

test('ignores unavailable and duplicate selections without duplicating rows', () => {
  const result = pinSelectedMaterials(
    materials,
    ['missing', 'b', 'b'],
    (material) => material.id === 'c'
  )

  assert.deepEqual(
    result.map((material) => material.id),
    ['b', 'c']
  )
})
