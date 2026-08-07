import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalizeStaticDataImagePath,
  findStaticDataImageByPath,
  indexStaticDataImagePaths
} from './static-data-image-path'

test('canonicalizes and resolves static-data image paths without changing stored keys', () => {
  const images = { 'ui/icons/item.tif': 'png-data' }

  assert.equal(canonicalizeStaticDataImagePath('/UI\\Icons\\ITEM.TIF'), 'ui/icons/item.tif')
  assert.equal(canonicalizeStaticDataImagePath('/UI/?SSET.TIF'), 'ui/?sset.tif')
  assert.equal(findStaticDataImageByPath(images, '/UI\\Icons\\ITEM.TIF'), 'png-data')
  assert.deepEqual(Object.keys(images), ['ui/icons/item.tif'])
})

test('rejects distinct static-data image paths with the same canonical identity', () => {
  assert.throws(
    () => indexStaticDataImagePaths(['ui/icons/item.tif', 'UI/ICONS/ITEM.TIF'], 'Images'),
    /Images contain colliding paths: ui\/icons\/item\.tif, UI\/ICONS\/ITEM\.TIF/
  )
})
