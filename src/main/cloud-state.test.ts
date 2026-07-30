import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { CloudOwnershipSnapshot, CloudSyncResponse } from './cloud-api'
import type { OwnershipSyncProfile } from './blueprint-ownership'
import {
  applyCloudSyncResponse,
  captureLocalProfiles,
  cloneCloudState,
  createCloudState,
  enqueueManualOperation,
  getCloudOwnershipLayer,
  getOrCreateNamespace,
  loadCloudState,
  parseCloudState,
  replaceCloudSnapshot,
  saveCloudState
} from './cloud-state'

const USER_A = '8d301e3e-6fd2-4900-a671-b20d48ab8403'
const USER_B = '71c34e0d-ca0b-4a68-aa40-0846d7f2e784'
const INSTALLATION_ID = 'a555284b-bf65-4558-a63b-a445477aec7f'
const PROFILE_ID = '22280eef-dce1-48ca-964f-8f11ddaf5e65'
const NOW = '2026-07-27T16:55:00.000Z'

test('cloud tombstones suppress legacy manual marks while pending actions override them', () => {
  const state = createCloudState(INSTALLATION_ID)
  state.lastUserId = USER_A
  const namespace = getOrCreateNamespace(state, USER_A)
  replaceCloudSnapshot(namespace, snapshot(false))

  const localProfiles: OwnershipSyncProfile[] = [
    {
      channel: 'LIVE',
      accountId: '123456789',
      handle: 'CurrentPilot',
      receipts: [],
      manualBlueprints: [{ blueprintId: 'duplicate-a', blueprintKey: 'duplicate-key-a' }]
    }
  ]
  const capture = captureLocalProfiles(state, USER_A, localProfiles)
  assert.equal(capture.queued, 0)
  assert.equal(
    getCloudOwnershipLayer(state, { channel: 'LIVE', accountId: '123456789' })?.manualBlueprints[0]
      .owned,
    false
  )

  assert.equal(
    enqueueManualOperation(
      state,
      USER_A,
      { channel: 'LIVE', accountId: '123456789', handle: 'CurrentPilot' },
      {
        blueprintId: 'duplicate-a',
        blueprintKey: 'duplicate-key-a',
        owned: true,
        changedAt: NOW
      }
    ).queued,
    true
  )
  assert.equal(
    getCloudOwnershipLayer(state, { channel: 'LIVE', accountId: '123456789' })?.manualBlueprints[0]
      .owned,
    true
  )
})

test('treats equivalent UTC receipt timestamp formats as already covered', () => {
  const state = createCloudState(INSTALLATION_ID)
  const namespace = getOrCreateNamespace(state, USER_A)
  const cloudSnapshot = snapshot(false)
  cloudSnapshot.profiles[0].receipts.push({
    normalizedName: 'quadracell',
    name: 'QuadraCell',
    firstSeenAt: '2026-07-27T16:55:00+00:00',
    lastSeenAt: '2026-07-27T16:55:00+00:00'
  })
  replaceCloudSnapshot(namespace, cloudSnapshot)

  const result = captureLocalProfiles(state, USER_A, [
    {
      channel: 'LIVE',
      accountId: '123456789',
      handle: 'CurrentPilot',
      receipts: [
        {
          normalizedName: 'quadracell',
          name: 'QuadraCell',
          firstSeenAt: '2026-07-27T16:55:00.000Z',
          lastSeenAt: '2026-07-27T16:55:00.000Z'
        }
      ],
      manualBlueprints: []
    }
  ])

  assert.equal(result.queued, 0)
})

test('persists stable pending operations and blocks cross-user profile import', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-cloud-state-'))
  const path = join(directory, 'cloud-state.json')
  const state = createCloudState(INSTALLATION_ID)
  const localProfiles: OwnershipSyncProfile[] = [
    {
      channel: 'LIVE',
      accountId: '123456789',
      handle: 'CurrentPilot',
      receipts: [
        {
          normalizedName: 'quadracell',
          name: 'QuadraCell',
          firstSeenAt: NOW,
          lastSeenAt: NOW
        }
      ],
      manualBlueprints: []
    }
  ]

  try {
    const firstCapture = captureLocalProfiles(state, USER_A, localProfiles)
    assert.equal(firstCapture.queued, 1)
    const operationId = state.namespaces[USER_A].pendingOperations[0].operationId
    await saveCloudState(path, state)

    const loaded = await loadCloudState(path)
    assert.equal(loaded.state.namespaces[USER_A].pendingOperations[0].operationId, operationId)
    const secondCapture = captureLocalProfiles(loaded.state, USER_A, localProfiles)
    assert.equal(secondCapture.queued, 0)
    const blocked = captureLocalProfiles(loaded.state, USER_B, localProfiles)
    assert.deepEqual(blocked.blockedProfileKeys, ['LIVE:123456789'])

    assert.deepEqual(parseCloudState(JSON.parse(await readFile(path, 'utf8')) as unknown), state)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('migrates persisted sessions without a role as non-admin and rejects unknown roles', () => {
  const state = createCloudState(INSTALLATION_ID)
  state.session = {
    apiUrl: 'http://127.0.0.1:5050',
    user: {
      id: USER_A,
      discordUserId: '80351110224678912',
      displayName: 'Nelly',
      avatarHash: null,
      role: 'admin'
    },
    encryptedRefreshToken: null,
    refreshExpiresAt: '2026-08-27T16:55:00.000Z'
  }
  const persisted = JSON.parse(JSON.stringify(state)) as {
    session: { user: { role?: string } }
  }
  delete persisted.session.user.role
  assert.equal(parseCloudState(persisted).session?.user.role, 'user')

  persisted.session.user.role = 'owner'
  assert.throws(() => parseCloudState(persisted), /unsupported role/)
})

test('applies acknowledgements, changes, and poison-operation quarantine atomically', () => {
  const state = createCloudState(INSTALLATION_ID)
  state.lastUserId = USER_A
  const namespace = getOrCreateNamespace(state, USER_A)
  replaceCloudSnapshot(namespace, snapshot(true))
  captureLocalProfiles(state, USER_A, [
    {
      channel: 'LIVE',
      accountId: '123456789',
      handle: 'CurrentPilot',
      receipts: [
        {
          normalizedName: 'atlas quantum drive',
          name: 'Atlas Quantum Drive',
          firstSeenAt: NOW,
          lastSeenAt: NOW
        },
        {
          normalizedName: 'poison',
          name: 'Poison',
          firstSeenAt: NOW,
          lastSeenAt: NOW
        }
      ],
      manualBlueprints: []
    }
  ])
  const [accepted, rejected] = namespace.pendingOperations
  const response: CloudSyncResponse = {
    acknowledgedOperationIds: [accepted.operationId],
    rejectedOperations: [
      {
        operationId: rejected.operationId,
        code: 'receipt_name_invalid',
        detail: 'The receipt name is not valid.',
        retryable: false
      }
    ],
    changes: [
      {
        cursor: '4220',
        kind: 'profile.upsert',
        profile: { channel: 'LIVE', accountId: '123456789', handle: 'RenamedPilot' }
      },
      {
        cursor: '4221',
        kind: 'receipt.upsert',
        profile: { channel: 'LIVE', accountId: '123456789', handle: 'RenamedPilot' },
        receipt: {
          normalizedName: 'atlas quantum drive',
          name: 'Atlas Quantum Drive',
          firstSeenAt: NOW,
          lastSeenAt: NOW
        }
      }
    ],
    nextCursor: '4221',
    hasMore: false,
    serverTime: NOW
  }
  const next = cloneCloudState(state)
  const nextNamespace = next.namespaces[USER_A]
  applyCloudSyncResponse(
    nextNamespace,
    response,
    new Set([accepted.operationId, rejected.operationId]),
    NOW
  )

  assert.equal(nextNamespace.pendingOperations.length, 0)
  assert.equal(nextNamespace.quarantinedOperations[0].operation.operationId, rejected.operationId)
  assert.equal(nextNamespace.cursor, '4221')
  assert.equal(nextNamespace.profiles['LIVE:123456789'].handle, 'RenamedPilot')
  assert.equal(
    getCloudOwnershipLayer(next, { channel: 'LIVE', accountId: '123456789' })?.receipts.some(
      (receipt) => receipt.name === 'Atlas Quantum Drive'
    ),
    true
  )
  assert.equal(
    captureLocalProfiles(next, USER_A, [
      {
        channel: 'LIVE',
        accountId: '123456789',
        handle: 'RenamedPilot',
        receipts: [
          {
            normalizedName: 'atlas quantum drive',
            name: 'Atlas Quantum Drive',
            firstSeenAt: NOW,
            lastSeenAt: NOW
          },
          {
            normalizedName: 'poison',
            name: 'Poison',
            firstSeenAt: NOW,
            lastSeenAt: NOW
          }
        ],
        manualBlueprints: []
      }
    ]).queued,
    0
  )
})

test('keeps signed-out and cross-user edits in the associated user outbox', () => {
  const state = createCloudState(INSTALLATION_ID)
  state.lastUserId = USER_A
  state.profileAssociations['LIVE:123456789'] = USER_A

  const signedOut = enqueueManualOperation(
    state,
    null,
    { channel: 'LIVE', accountId: '123456789', handle: 'CurrentPilot' },
    {
      blueprintId: 'duplicate-a',
      blueprintKey: 'duplicate-key-a',
      owned: false,
      changedAt: NOW
    }
  )
  assert.equal(signedOut.queued, true)
  assert.equal(signedOut.targetUserId, USER_A)

  const crossUser = enqueueManualOperation(
    state,
    USER_B,
    { channel: 'LIVE', accountId: '123456789', handle: 'CurrentPilot' },
    {
      blueprintId: 'duplicate-b',
      blueprintKey: 'duplicate-key-b',
      owned: true,
      changedAt: NOW
    }
  )
  assert.equal(crossUser.targetUserId, USER_A)
  assert.equal(crossUser.blockedProfileKey, 'LIVE:123456789')
  assert.equal(state.profileAssociations['LIVE:123456789'], USER_A)
  assert.equal(state.namespaces[USER_A].pendingOperations.length, 2)
  const userBNamespaceBeforeConfirmation = state.namespaces[USER_B]
  assert.equal(userBNamespaceBeforeConfirmation, undefined)

  const confirmed = captureLocalProfiles(
    state,
    USER_B,
    [
      {
        channel: 'LIVE',
        accountId: '123456789',
        handle: 'CurrentPilot',
        receipts: [],
        manualBlueprints: [
          { blueprintId: 'duplicate-a', blueprintKey: 'duplicate-key-a' },
          { blueprintId: 'duplicate-b', blueprintKey: 'duplicate-key-b' }
        ]
      }
    ],
    true
  )
  assert.deepEqual(confirmed.blockedProfileKeys, [])
  assert.equal(state.profileAssociations['LIVE:123456789'], USER_B)
  assert.equal(state.namespaces[USER_A].pendingOperations.length, 0)
  assert.equal(state.namespaces[USER_B].pendingOperations.length, 2)
})

test('does not assign unassociated signed-out data to the last Discord user', () => {
  const state = createCloudState(INSTALLATION_ID)
  state.lastUserId = USER_A
  const localProfiles: OwnershipSyncProfile[] = [
    {
      channel: 'LIVE',
      accountId: '123456789',
      handle: 'CurrentPilot',
      receipts: [
        {
          normalizedName: 'quadracell',
          name: 'QuadraCell',
          firstSeenAt: NOW,
          lastSeenAt: NOW
        }
      ],
      manualBlueprints: []
    }
  ]

  assert.equal(captureLocalProfiles(state, null, localProfiles).queued, 0)
  assert.equal(state.namespaces[USER_A], undefined)
  assert.equal(state.profileAssociations['LIVE:123456789'], undefined)

  assert.equal(captureLocalProfiles(state, USER_B, localProfiles).queued, 1)
  assert.equal(state.profileAssociations['LIVE:123456789'], USER_B)
  assert.equal(state.namespaces[USER_A], undefined)
  assert.equal(state.namespaces[USER_B].pendingOperations.length, 1)
})

test('queues distinct manual operations whose blueprint keys are duplicated', () => {
  const state = createCloudState(INSTALLATION_ID)
  const profile = { channel: 'LIVE', accountId: '123456789', handle: 'CurrentPilot' }

  const first = enqueueManualOperation(state, USER_A, profile, {
    blueprintId: 'duplicate-a',
    blueprintKey: 'shared-key',
    owned: false,
    changedAt: NOW
  })
  const second = enqueueManualOperation(state, USER_A, profile, {
    blueprintId: 'duplicate-b',
    blueprintKey: 'shared-key',
    owned: false,
    changedAt: NOW
  })

  assert.equal(first.queued, true)
  assert.equal(second.queued, true)
  assert.equal(state.namespaces[USER_A].pendingOperations.length, 2)
  assert.equal(
    state.namespaces[USER_A].pendingOperations.every(
      (operation) =>
        operation.kind === 'manual.set' && operation.manual.blueprintKeyIsUnique === false
    ),
    true
  )
})

test('does not fall back to another known account and preserves duplicate blueprint keys', () => {
  const state = createCloudState(INSTALLATION_ID)
  state.lastUserId = USER_A
  const namespace = getOrCreateNamespace(state, USER_A)
  const cloudSnapshot = snapshot(true)
  cloudSnapshot.profiles[0].manualBlueprints.push({
    blueprintId: 'duplicate-b',
    blueprintKey: 'duplicate-key-a',
    owned: false,
    changedAt: NOW
  })
  replaceCloudSnapshot(namespace, cloudSnapshot)

  assert.equal(getCloudOwnershipLayer(state, { channel: 'LIVE', accountId: '999999999' }), null)
  assert.equal(
    getCloudOwnershipLayer(state, { channel: 'LIVE', accountId: '123456789' })?.manualBlueprints
      .length,
    2
  )
})

test('reconciles superseded IDs only when the catalog key is unique', () => {
  const state = createCloudState(INSTALLATION_ID)
  const namespace = getOrCreateNamespace(state, USER_A)
  replaceCloudSnapshot(namespace, snapshot(true))

  const applyManual = (cursor: string, blueprintId: string, owned: boolean): void => {
    applyCloudSyncResponse(
      namespace,
      {
        acknowledgedOperationIds: [],
        rejectedOperations: [],
        changes: [
          {
            cursor,
            kind: 'manual.set',
            profile: { channel: 'LIVE', accountId: '123456789', handle: 'CurrentPilot' },
            manual: {
              blueprintId,
              blueprintKey: 'duplicate-key-a',
              owned,
              changedAt: NOW
            }
          }
        ],
        nextCursor: cursor,
        hasMore: false,
        serverTime: NOW
      },
      new Set(),
      NOW,
      (blueprintKey) => blueprintKey === 'duplicate-key-a'
    )
  }

  applyManual('4220', 'duplicate-b', false)
  applyManual('4221', 'duplicate-a', true)
  assert.deepEqual(Object.keys(namespace.profiles['LIVE:123456789'].manualBlueprints), [
    'duplicate-a'
  ])
  assert.equal(namespace.profiles['LIVE:123456789'].manualBlueprints['duplicate-a'].owned, true)
})

test('keeps rejection fingerprints after bounded quarantine history evicts details', () => {
  const state = createCloudState(INSTALLATION_ID)
  const namespace = getOrCreateNamespace(state, USER_A)

  for (let index = 0; index < 101; index += 1) {
    const receipt = {
      normalizedName: `poison ${index}`,
      name: `Poison ${index}`,
      firstSeenAt: NOW,
      lastSeenAt: NOW
    }
    assert.equal(
      captureLocalProfiles(state, USER_A, [
        {
          channel: 'LIVE',
          accountId: '123456789',
          handle: 'CurrentPilot',
          receipts: [receipt],
          manualBlueprints: []
        }
      ]).queued,
      1
    )
    const operation = namespace.pendingOperations[0]
    applyCloudSyncResponse(
      namespace,
      {
        acknowledgedOperationIds: [],
        rejectedOperations: [
          {
            operationId: operation.operationId,
            code: 'receipt_name_invalid',
            detail: 'The receipt is permanently invalid.',
            retryable: false
          }
        ],
        changes: [],
        nextCursor: String(index),
        hasMore: false,
        serverTime: NOW
      },
      new Set([operation.operationId]),
      NOW
    )
  }

  assert.equal(namespace.quarantinedOperations.length, 100)
  assert.equal(Object.keys(namespace.rejectedOperationFingerprints).length, 101)
  assert.equal(
    captureLocalProfiles(state, USER_A, [
      {
        channel: 'LIVE',
        accountId: '123456789',
        handle: 'CurrentPilot',
        receipts: [
          {
            normalizedName: 'poison 0',
            name: 'Poison 0',
            firstSeenAt: NOW,
            lastSeenAt: NOW
          }
        ],
        manualBlueprints: []
      }
    ]).queued,
    0
  )
})

test('captures a valid large import in bounded chunks instead of failing', () => {
  const state = createCloudState(INSTALLATION_ID)
  const profiles: OwnershipSyncProfile[] = Array.from({ length: 3 }, (_, profileIndex) => ({
    channel: 'LIVE',
    accountId: String(100 + profileIndex),
    handle: `Pilot${profileIndex}`,
    receipts: Array.from({ length: 4_000 }, (_, receiptIndex) => ({
      normalizedName: `receipt ${profileIndex} ${receiptIndex}`,
      name: `Receipt ${profileIndex} ${receiptIndex}`,
      firstSeenAt: NOW,
      lastSeenAt: NOW
    })),
    manualBlueprints: []
  }))

  const result = captureLocalProfiles(state, USER_A, profiles)
  assert.equal(result.queued, 10_000)
  assert.equal(result.hasMore, true)
  assert.equal(state.namespaces[USER_A].pendingOperations.length, 10_000)
})

function snapshot(owned: boolean): CloudOwnershipSnapshot {
  return {
    cursor: '4219',
    profiles: [
      {
        profileId: PROFILE_ID,
        channel: 'LIVE',
        accountId: '123456789',
        handle: 'CurrentPilot',
        receipts: [],
        manualBlueprints: [
          {
            blueprintId: 'duplicate-a',
            blueprintKey: 'duplicate-key-a',
            owned,
            changedAt: NOW
          }
        ]
      }
    ],
    serverTime: NOW
  }
}
