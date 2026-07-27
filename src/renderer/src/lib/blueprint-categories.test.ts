import assert from 'node:assert/strict'
import test from 'node:test'

import { getBlueprintCategoryOptions, matchesBlueprintCategory } from './blueprint-categories'

const blueprints = [
  {
    outputType: 'WeaponGun.Gun',
    outputTypeLabel: 'Ship cannon'
  },
  {
    outputType: 'Char_Armor_Core',
    outputTypeLabel: 'Core (Armor)'
  },
  {
    outputType: 'Char_Armor_Arms',
    outputTypeLabel: 'Arms (Armor)'
  },
  {
    outputType: 'Char_Armor_Arms',
    outputTypeLabel: 'Arms (Armor)'
  }
]

test('builds sorted, unique blueprint category options', () => {
  assert.deepEqual(getBlueprintCategoryOptions(blueprints), [
    { value: 'Char_Armor_Arms', label: 'Arms (Armor)' },
    { value: 'Char_Armor_Core', label: 'Core (Armor)' },
    { value: 'WeaponGun.Gun', label: 'Ship cannon' }
  ])
})

test('matches all categories or one exact item category', () => {
  assert.equal(matchesBlueprintCategory(blueprints[0], ''), true)
  assert.equal(matchesBlueprintCategory(blueprints[0], 'WeaponGun.Gun'), true)
  assert.equal(matchesBlueprintCategory(blueprints[0], 'Char_Armor_Arms'), false)
})
