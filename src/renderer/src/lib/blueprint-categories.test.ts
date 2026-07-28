import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getBlueprintCategoryOptions,
  getBlueprintSubcategoryOptions,
  matchesBlueprintCategory
} from './blueprint-categories'

const blueprints = [
  {
    outputType: 'WeaponGun',
    outputTypeLabel: 'Cannon'
  },
  {
    outputType: 'Char_Armor_Torso',
    outputTypeLabel: 'Armor: Core'
  },
  {
    outputType: 'Char_Armor_Arms',
    outputTypeLabel: 'Armor: Arms'
  },
  {
    outputType: 'WeaponPersonal',
    outputTypeLabel: 'Pistol'
  },
  {
    outputType: 'WeaponPersonal',
    outputTypeLabel: 'Rifle'
  },
  {
    outputType: 'Utility',
    outputTypeLabel: 'Utility item'
  }
]

test('builds sorted, unique remapped category options', () => {
  assert.deepEqual(getBlueprintCategoryOptions(blueprints), [
    { value: 'Armor', label: 'Armor' },
    { value: 'Misc', label: 'Misc' },
    { value: 'Vehicles', label: 'Vehicles' },
    { value: 'Weapons', label: 'Weapons' }
  ])
})

test('builds subcategory options for the selected category', () => {
  assert.deepEqual(getBlueprintSubcategoryOptions(blueprints, 'Armor'), [
    { value: 'Arms', label: 'Arms' },
    { value: 'Core', label: 'Core' }
  ])
  assert.deepEqual(getBlueprintSubcategoryOptions(blueprints, 'Weapons'), [
    { value: 'Primary', label: 'Primary' },
    { value: 'Sidearm', label: 'Sidearm' }
  ])
  assert.deepEqual(getBlueprintSubcategoryOptions(blueprints, ''), [])
})

test('matches remapped categories and subcategories', () => {
  assert.equal(matchesBlueprintCategory(blueprints[0], ''), true)
  assert.equal(matchesBlueprintCategory(blueprints[0], 'Vehicles', 'Weapons'), true)
  assert.equal(matchesBlueprintCategory(blueprints[1], 'Armor'), true)
  assert.equal(matchesBlueprintCategory(blueprints[1], 'Armor', 'Core'), true)
  assert.equal(matchesBlueprintCategory(blueprints[1], 'Armor', 'Arms'), false)
  assert.equal(matchesBlueprintCategory(blueprints[3], 'Weapons', 'Sidearm'), true)
  assert.equal(matchesBlueprintCategory(blueprints[4], 'Weapons', 'Primary'), true)
  assert.equal(matchesBlueprintCategory(blueprints[5], 'Misc', 'Utility item'), true)
})
