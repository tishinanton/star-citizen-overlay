import assert from 'node:assert/strict'
import test from 'node:test'

import { buildClusterSignatures } from './signatures'

test('builds base and cluster signatures through the requested maximum', () => {
  assert.deepEqual(buildClusterSignatures(3_400, 4), [
    { count: 1, signature: 3_400 },
    { count: 2, signature: 6_800 },
    { count: 3, signature: 10_200 },
    { count: 4, signature: 13_600 }
  ])
})

test('rejects invalid base signatures and cluster limits', () => {
  assert.throws(() => buildClusterSignatures(0, 4), /positive number/)
  assert.throws(() => buildClusterSignatures(4_000, 9), /between 1 and 8/)
})
