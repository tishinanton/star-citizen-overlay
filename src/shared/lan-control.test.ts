import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseLanCommandRequest,
  parseLanOverlayCommand,
  parseLanPairingRequest
} from './lan-control'

const requestId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'

test('parses every LAN overlay command operation', () => {
  const expected = { runId, revision: 7 }

  assert.deepEqual(
    parseLanCommandRequest({
      requestId,
      expected,
      operation: 'overlay.item.add',
      itemId: 'riccite-ore',
      futureField: true
    }),
    {
      requestId,
      expected,
      operation: 'overlay.item.add',
      itemId: 'riccite-ore'
    }
  )
  assert.equal(
    parseLanCommandRequest({
      requestId,
      expected,
      operation: 'overlay.item.remove',
      itemId: 'riccite-ore'
    }).operation,
    'overlay.item.remove'
  )
  assert.deepEqual(
    parseLanCommandRequest({
      requestId,
      expected,
      operation: 'overlay.compact.set',
      enabled: true
    }),
    {
      requestId,
      expected,
      operation: 'overlay.compact.set',
      enabled: true
    }
  )
  assert.equal(
    parseLanCommandRequest({
      requestId,
      expected,
      operation: 'overlay.target.cycle'
    }).operation,
    'overlay.target.cycle'
  )
})

test('rejects malformed and unsupported LAN commands', () => {
  assert.throws(
    () =>
      parseLanCommandRequest({
        requestId: 'not-a-uuid',
        expected: { runId, revision: 0 },
        operation: 'overlay.target.cycle'
      }),
    /must be a UUID/
  )
  assert.throws(
    () =>
      parseLanCommandRequest({
        requestId,
        expected: { runId, revision: -1 },
        operation: 'overlay.target.cycle'
      }),
    /non-negative integer/
  )
  assert.throws(
    () =>
      parseLanCommandRequest({
        requestId,
        expected: { runId, revision: 0 },
        operation: 'overlay.visibility.set'
      }),
    /not supported/
  )
})

test('parses the same narrow operation shape for trusted desktop IPC', () => {
  assert.deepEqual(
    parseLanOverlayCommand({
      operation: 'overlay.compact.set',
      enabled: false,
      ignored: 'future'
    }),
    {
      operation: 'overlay.compact.set',
      enabled: false
    }
  )
})

test('parses Android pairing metadata without retaining unknown fields', () => {
  assert.deepEqual(
    parseLanPairingRequest({
      code: '123456',
      client: {
        name: ' Pixel 9 ',
        platform: 'android',
        appVersion: '1.2.3',
        ignored: 'future'
      }
    }),
    {
      code: '123456',
      client: {
        name: 'Pixel 9',
        platform: 'android',
        appVersion: '1.2.3'
      }
    }
  )
})

test('rejects invalid pairing codes and client platforms', () => {
  assert.throws(
    () =>
      parseLanPairingRequest({
        code: '12345',
        client: { name: 'Phone', platform: 'android' }
      }),
    /six digits/
  )
  assert.throws(
    () =>
      parseLanPairingRequest({
        code: '123456',
        client: { name: 'Browser', platform: 'web' }
      }),
    /must be android/
  )
})
