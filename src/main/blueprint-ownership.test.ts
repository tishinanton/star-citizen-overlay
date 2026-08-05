import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { BlueprintSummary } from '../shared/contracts'
import {
  BlueprintOwnershipService,
  parseBlueprintOwnershipStore,
  resolveBlueprintOwnership
} from './blueprint-ownership'

const BLUEPRINTS: BlueprintSummary[] = [
  blueprint('default-id', 'BP_DEFAULT', 'Default Tool', true),
  blueprint('unique-id', 'BP_UNIQUE', 'QuadraCell'),
  blueprint('duplicate-a', 'BP_DUPLICATE_A', 'Cinch Scraper Module'),
  blueprint('duplicate-b', 'BP_DUPLICATE_B', 'Cinch Scraper Module')
]

test('resolves defaults and unique receipts without guessing duplicate names', () => {
  const store = parseBlueprintOwnershipStore({
    schemaVersion: 1,
    profiles: {
      'LIVE:123': {
        channel: 'LIVE',
        accountId: '123',
        handle: 'CurrentPilot',
        receipts: {
          'mil/1/a quadracell': {
            name: 'Mil/1/A QuadraCell',
            firstSeenAt: '2026-07-06T16:34:10.381Z',
            lastSeenAt: '2026-07-06T16:34:10.381Z'
          },
          'cinch scraper module': {
            name: 'Cinch Scraper Module',
            firstSeenAt: '2026-07-18T18:48:13.654Z',
            lastSeenAt: '2026-07-19T14:03:36.090Z'
          }
        },
        manualBlueprints: {}
      }
    }
  })

  const result = resolveBlueprintOwnership(BLUEPRINTS, store.profiles['LIVE:123'])
  assert.equal(result.ownedCount, 2)
  assert.equal(result.defaultCount, 1)
  assert.equal(result.logCount, 1)
  assert.equal(result.manualCount, 0)
  assert.equal(result.records['unique-id'].source, 'log')
  assert.equal(result.records['duplicate-a'], undefined)
  assert.equal(result.records['duplicate-b'], undefined)
  assert.deepEqual(result.unresolvedReceiptNames, ['Cinch Scraper Module'])
})

test('a specific manual mark resolves an ambiguous log receipt', () => {
  const store = parseBlueprintOwnershipStore({
    schemaVersion: 1,
    profiles: {
      'LIVE:123': {
        channel: 'LIVE',
        accountId: '123',
        handle: null,
        receipts: {
          'cinch scraper module': {
            name: 'Cinch Scraper Module',
            firstSeenAt: '2026-07-18T18:48:13.654Z',
            lastSeenAt: '2026-07-19T14:03:36.090Z'
          }
        },
        manualBlueprints: {
          'duplicate-a': {
            blueprintId: 'duplicate-a',
            blueprintKey: 'BP_DUPLICATE_A'
          }
        }
      }
    }
  })

  const result = resolveBlueprintOwnership(BLUEPRINTS, store.profiles['LIVE:123'])
  assert.equal(result.records['duplicate-a'].source, 'manual')
  assert.deepEqual(result.unresolvedReceiptNames, [])
})

test('cloud tombstones suppress only manual ownership and newer pending state can restore it', () => {
  const store = parseBlueprintOwnershipStore({
    schemaVersion: 1,
    profiles: {
      'LIVE:123': {
        channel: 'LIVE',
        accountId: '123',
        handle: null,
        receipts: {},
        manualBlueprints: {
          'duplicate-a': {
            blueprintId: 'duplicate-a',
            blueprintKey: 'BP_DUPLICATE_A'
          }
        }
      }
    }
  })
  const tombstone = {
    receipts: [],
    manualBlueprints: [
      {
        blueprintId: 'duplicate-a',
        blueprintKey: 'BP_DUPLICATE_A',
        owned: false,
        changedAt: '2026-07-27T16:55:00.000Z'
      }
    ]
  }

  const cleared = resolveBlueprintOwnership(BLUEPRINTS, store.profiles['LIVE:123'], tombstone)
  assert.equal(cleared.records['duplicate-a'], undefined)
  assert.equal(cleared.records['default-id'].source, 'default')

  const restored = resolveBlueprintOwnership(BLUEPRINTS, store.profiles['LIVE:123'], {
    ...tombstone,
    manualBlueprints: [{ ...tombstone.manualBlueprints[0], owned: true }]
  })
  assert.equal(restored.records['duplicate-a'].source, 'manual')
})

test('rejects malformed persisted ownership data', () => {
  assert.throws(() => parseBlueprintOwnershipStore({}), /unsupported shape/)
  const repaired = parseBlueprintOwnershipStore({
    schemaVersion: 1,
    profiles: {
      wrong: {
        channel: 'LIVE',
        accountId: '123',
        handle: null,
        receipts: {
          obsolete: {
            name: 'QuadraCell',
            firstSeenAt: '2026-07-06T16:34:10.381Z',
            lastSeenAt: '2026-07-06T16:34:10.381Z'
          },
          malformed: {
            name: '',
            firstSeenAt: 'invalid',
            lastSeenAt: 'invalid'
          }
        },
        manualBlueprints: {
          old: {
            blueprintId: 'duplicate-a',
            blueprintKey: 'BP_DUPLICATE_A'
          },
          malformed: {
            blueprintId: '',
            blueprintKey: ''
          }
        }
      }
    }
  })
  assert.deepEqual(Object.keys(repaired.profiles), ['LIVE:123'])
  assert.deepEqual(Object.keys(repaired.profiles['LIVE:123'].receipts), ['quadracell'])
  assert.deepEqual(Object.keys(repaired.profiles['LIVE:123'].manualBlueprints), ['duplicate-a'])
})

test('persists manual ownership and restores it without game files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-ownership-'))
  const storePath = join(directory, 'ownership.json')
  const first = new BlueprintOwnershipService({ storePath, onChange: () => undefined })

  try {
    await first.initialize()
    await first.setManualOwned(BLUEPRINTS[2], true)
    assert.equal(first.getSnapshot(BLUEPRINTS).records['duplicate-a'].source, 'manual')
    first.dispose()

    const restored = new BlueprintOwnershipService({ storePath, onChange: () => undefined })
    await restored.initialize()
    assert.equal(restored.getSnapshot(BLUEPRINTS).records['duplicate-a'].source, 'manual')
    await restored.setManualOwned(BLUEPRINTS[2], false)
    assert.equal(restored.getSnapshot(BLUEPRINTS).records['duplicate-a'], undefined)
    restored.dispose()
  } finally {
    first.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('imports account-scoped ownership from the selected game channel', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-service-'))
  const storePath = join(directory, 'ownership.json')
  const archivePath = join(directory, 'Data.p4k')
  await writeFile(archivePath, '')
  await writeFile(
    join(directory, 'Game.log'),
    [
      '<2026-07-20T10:00:00.000Z> [Notice] <AccountLoginCharacterStatus_Character> Character: createdAt 1 - updatedAt 2 - geid 3 - accountId 123 - name CurrentPilot - state STATE_CURRENT [Team_GameServices][Login]',
      '<2026-07-20T10:01:00.000Z> [Notice] <SHUDEvent_OnNotification> Added notification "Received Blueprint: QuadraCell: " [23] to queue. New queue size: 2, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]'
    ].join('\n')
  )
  const service = new BlueprintOwnershipService({
    storePath,
    onChange: () => undefined,
    monitorIntervalMs: 20
  })

  try {
    await service.initialize()
    await service.configure({ path: archivePath, channel: 'LIVE' })
    const snapshot = service.getSnapshot(BLUEPRINTS)
    assert.equal(snapshot.status, 'watching')
    assert.equal(snapshot.filesScanned, 1)
    assert.equal(snapshot.records['unique-id'].source, 'log')

    await appendFile(
      join(directory, 'Game.log'),
      [
        '',
        '<2026-07-20T10:55:00.000Z> [Notice] <SHUDEvent_OnNotification> Added notification "Received Blueprint: QuadraCell: " [24] to queue. New queue size: 2, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]',
        '<2026-07-20T11:00:00.000Z> [Notice] <AccountLoginCharacterStatus_Character> Character: createdAt 1 - updatedAt 2 - geid 4 - accountId 456 - name NextPilot - state STATE_CURRENT [Team_GameServices][Login]',
        ''
      ].join('\n')
    )
    await waitFor(() => service.getSnapshot(BLUEPRINTS).records['unique-id'] === undefined)
    assert.equal(service.getSnapshot(BLUEPRINTS).ownedCount, 1)
  } finally {
    service.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('does not attribute a live receipt without an account identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-unassigned-'))
  const storePath = join(directory, 'ownership.json')
  const archivePath = join(directory, 'Data.p4k')
  await writeFile(archivePath, '')
  await writeFile(join(directory, 'Game.log'), '')
  const service = new BlueprintOwnershipService({
    storePath,
    onChange: () => undefined,
    monitorIntervalMs: 20
  })

  try {
    await service.initialize()
    await service.configure({ path: archivePath, channel: 'LIVE' })
    await appendFile(
      join(directory, 'Game.log'),
      '<2026-07-20T10:01:00.000Z> [Notice] <SHUDEvent_OnNotification> Added notification "Received Blueprint: QuadraCell: " [23] to queue. New queue size: 2, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]\n'
    )
    await waitFor(() => service.getSnapshot(BLUEPRINTS).unassignedReceiptCount === 1)
    const snapshot = service.getSnapshot(BLUEPRINTS)
    assert.equal(snapshot.records['unique-id'], undefined)
    assert.equal(snapshot.ownedCount, 1)
  } finally {
    service.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('retries a failed manual save without losing the in-memory mark', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-save-retry-'))
  const blockedParent = join(directory, 'blocked')
  const storePath = join(blockedParent, 'ownership.json')
  const service = new BlueprintOwnershipService({ storePath, onChange: () => undefined })

  try {
    await service.initialize()
    await writeFile(blockedParent, 'not a directory')
    await assert.rejects(service.setManualOwned(BLUEPRINTS[2], true))
    assert.equal(service.getSnapshot(BLUEPRINTS).records['duplicate-a'].source, 'manual')

    await rm(blockedParent)
    await mkdir(blockedParent)
    await service.setManualOwned(BLUEPRINTS[2], true)
    service.dispose()

    const restored = new BlueprintOwnershipService({ storePath, onChange: () => undefined })
    await restored.initialize()
    assert.equal(restored.getSnapshot(BLUEPRINTS).records['duplicate-a'].source, 'manual')
    restored.dispose()
  } finally {
    service.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('preserves an unreadable ownership file before rebuilding it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-recovery-'))
  const storePath = join(directory, 'ownership.json')
  await writeFile(storePath, '{not valid json')
  const service = new BlueprintOwnershipService({ storePath, onChange: () => undefined })

  try {
    await service.initialize()
    assert.match(service.getSnapshot(BLUEPRINTS).message, /original file was preserved/)
    assert.equal(
      (await readdir(directory)).filter((name) => name.startsWith('ownership.json.recovery-'))
        .length,
      1
    )
    await service.setManualOwned(BLUEPRINTS[2], true)

    const restored = new BlueprintOwnershipService({ storePath, onChange: () => undefined })
    await restored.initialize()
    assert.equal(restored.getSnapshot(BLUEPRINTS).records['duplicate-a'].source, 'manual')
    restored.dispose()
  } finally {
    service.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('clearing one manual mark preserves another mark with the same blueprint key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-duplicate-key-'))
  const storePath = join(directory, 'ownership.json')
  const service = new BlueprintOwnershipService({ storePath, onChange: () => undefined })
  const duplicateKeyBlueprints = [
    blueprint('same-key-a', 'SHARED_KEY', 'First output'),
    blueprint('same-key-b', 'SHARED_KEY', 'Second output')
  ]

  try {
    await service.initialize()
    await service.setManualOwned(duplicateKeyBlueprints[0], true)
    await service.setManualOwned(duplicateKeyBlueprints[1], true)
    assert.equal(
      service.getSyncProfiles(duplicateKeyBlueprints)[0].manualBlueprints[0].keyIsUnique,
      false
    )
    assert.equal(
      service.getSyncProfiles([duplicateKeyBlueprints[0]])[0].manualBlueprints[0].keyIsUnique,
      true
    )
    assert.deepEqual(service.getSyncProfiles([], false)[0].manualBlueprints, [])
    await service.setManualOwned(duplicateKeyBlueprints[0], false)

    const snapshot = service.getSnapshot(duplicateKeyBlueprints)
    assert.equal(snapshot.records['same-key-a'], undefined)
    assert.equal(snapshot.records['same-key-b'].source, 'manual')
  } finally {
    service.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

function blueprint(
  id: string,
  key: string,
  outputName: string,
  availableByDefault = false
): BlueprintSummary {
  return {
    id,
    key,
    outputName,
    outputClass: `${id}-class`,
    outputType: 'Test',
    outputTypeLabel: 'Test item',
    outputGrade: null,
    craftTimeSeconds: 60,
    craftTimeLabel: '1 minute',
    availableByDefault,
    ingredientCount: 0,
    unlockingMissionCount: availableByDefault ? 0 : 1,
    ingredients: [],
    gameVersion: '4.9-test',
    imageKey: null,
    renderAsset: null,
    webUrl: null
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for ownership state.')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
