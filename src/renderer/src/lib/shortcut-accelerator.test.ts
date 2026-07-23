import assert from 'node:assert/strict'
import test from 'node:test'

import { getAccelerator } from './shortcut-accelerator'

test('creates an Electron accelerator from a modified letter', () => {
  assert.equal(
    getAccelerator({
      code: 'KeyK',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true
    }),
    'CommandOrControl+Shift+K'
  )
})

test('allows function keys without a modifier', () => {
  assert.equal(
    getAccelerator({
      code: 'F8',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false
    }),
    'F8'
  )
})

test('rejects unmodified regular keys and modifier-only input', () => {
  assert.equal(
    getAccelerator({
      code: 'KeyM',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false
    }),
    null
  )
  assert.equal(
    getAccelerator({
      code: 'ControlLeft',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false
    }),
    null
  )
})
