import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  BlueprintLogMonitor,
  normalizeBlueprintName,
  parseBlueprintLogIdentity,
  parseBlueprintReceiptLine,
  scanBlueprintLogs
} from './blueprint-log'

function identityLine(timestamp: string, accountId: string, handle: string): string {
  return `<${timestamp}> [Notice] <AccountLoginCharacterStatus_Character> Character: createdAt 1 - updatedAt 2 - geid 3 - accountId ${accountId} - name ${handle} - state STATE_CURRENT [Team_GameServices][Login]`
}

function receiptLine(timestamp: string, name: string): string {
  return `<${timestamp}> [Notice] <SHUDEvent_OnNotification> Added notification "Received Blueprint: ${name}: " [23] to queue. New queue size: 2, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]`
}

test('parses only authoritative blueprint receipts and account identities', () => {
  const timestamp = '2026-07-18T18:48:13.654Z'
  const parsed = parseBlueprintReceiptLine(receiptLine(timestamp, 'Demeco "Purgatory Camo" LMG'))
  assert.deepEqual(parsed, {
    name: 'Demeco "Purgatory Camo" LMG',
    normalizedName: 'demeco "purgatory camo" lmg',
    acquiredAt: timestamp
  })
  assert.equal(
    parseBlueprintReceiptLine(
      `<${timestamp}> [Notice] <UpdateNotificationItem> Notification "Received Blueprint: Demeco: " [23], Action: Next`
    ),
    null
  )
  assert.equal(
    parseBlueprintReceiptLine(
      `<${timestamp}> [Notice] <ReuseChannel> Reusing sc.external.services.blueprint_library.v1.BlueprintLibraryService`
    ),
    null
  )
  assert.deepEqual(parseBlueprintLogIdentity(identityLine(timestamp, '12345', 'CargoPilot')), {
    accountId: '12345',
    handle: 'CargoPilot'
  })
  assert.equal(normalizeBlueprintName('  Lynx\u00a0“Wild”  Legs '), 'lynx "wild" legs')
})

test('scans log backups and keeps the live account active', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-logs-'))
  const backups = join(directory, 'logbackups')
  await mkdir(backups)
  await writeFile(
    join(backups, 'backup.log'),
    [
      identityLine('2026-07-01T10:00:00.000Z', '111', 'FirstPilot'),
      receiptLine('2026-07-01T10:01:00.000Z', 'Lawson Mining Laser'),
      receiptLine('2026-07-01T10:02:00.000Z', 'Lawson Mining Laser')
    ].join('\n')
  )
  await writeFile(
    join(directory, 'Game.log'),
    [
      identityLine('2026-07-20T10:00:00.000Z', '222', 'CurrentPilot'),
      receiptLine('2026-07-20T10:01:00.000Z', 'Abrade Scraper Module')
    ].join('\n')
  )

  try {
    const result = await scanBlueprintLogs(directory)
    assert.equal(result.filesScanned, 2)
    assert.equal(result.filesSkipped, 0)
    assert.deepEqual(result.activeIdentity, { accountId: '222', handle: 'CurrentPilot' })
    assert.deepEqual(
      result.profiles.map((profile) => [
        profile.accountId,
        profile.receipts.map((receipt) => receipt.name)
      ]),
      [
        ['111', ['Lawson Mining Laser']],
        ['222', ['Abrade Scraper Module']]
      ]
    )
    assert.equal(result.profiles[0].receipts[0].lastSeenAt, '2026-07-01T10:02:00.000Z')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('keeps receipts without a session identity unassigned', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-unassigned-scan-'))
  const backups = join(directory, 'logbackups')
  await mkdir(backups)
  await writeFile(
    join(backups, 'orphan.log'),
    `${receiptLine('2026-07-01T09:00:00.000Z', 'Orphan Blueprint')}\n`
  )
  await writeFile(
    join(directory, 'Game.log'),
    `${identityLine('2026-07-20T10:00:00.000Z', '222', 'CurrentPilot')}\n`
  )

  try {
    const result = await scanBlueprintLogs(directory)
    assert.equal(result.unassignedReceiptCount, 1)
    assert.deepEqual(result.profiles, [{ accountId: '222', handle: 'CurrentPilot', receipts: [] }])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('monitors appended blueprint receipts without replaying existing lines', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-monitor-'))
  const logPath = join(directory, 'Game.log')
  await writeFile(logPath, `${receiptLine('2026-07-20T10:00:00.000Z', 'Existing Blueprint')}\n`)

  const received: string[] = []
  const identities: string[] = []
  let rotations = 0
  const monitor = new BlueprintLogMonitor({
    intervalMs: 20,
    onReceipts: (receipts) => {
      received.push(...receipts.map((receipt) => receipt.name))
    },
    onIdentity: (identity) => {
      identities.push(identity.accountId)
    },
    onRotation: () => {
      rotations += 1
    },
    onError: (error) => {
      throw error
    }
  })

  try {
    await monitor.start(directory)
    monitor.setFallbackIdentity({ accountId: '123', handle: 'CurrentPilot' })
    await appendFile(logPath, `${receiptLine('2026-07-20T10:05:00.000Z', 'New Blueprint')}\n`)
    await waitFor(() => received.includes('New Blueprint'))
    assert.deepEqual(received, ['New Blueprint'])

    await writeFile(
      logPath,
      [
        identityLine('2026-07-21T10:00:00.000Z', '456', 'NextPilot'),
        receiptLine('2026-07-21T10:05:00.000Z', 'After Rotation')
      ].join('\n') + '\n'
    )
    await waitFor(() => received.includes('After Rotation'))
    assert.deepEqual(received, ['New Blueprint', 'After Rotation'])
    assert.deepEqual(identities, ['456'])
    assert.equal(rotations, 1)

    const utf8Line = Buffer.from(
      `${receiptLine('2026-07-21T10:10:00.000Z', 'Café Blueprint')}\n`,
      'utf8'
    )
    const multibyteCharacter = Buffer.from('é', 'utf8')
    const characterIndex = utf8Line.indexOf(multibyteCharacter)
    assert.notEqual(characterIndex, -1)
    await appendFile(logPath, utf8Line.subarray(0, characterIndex + 1))
    await new Promise((resolve) => setTimeout(resolve, 100))
    await appendFile(logPath, utf8Line.subarray(characterIndex + 1))
    await waitFor(() => received.includes('Café Blueprint'))
    assert.deepEqual(received, ['New Blueprint', 'After Rotation', 'Café Blueprint'])
  } finally {
    monitor.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the blueprint log monitor.')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
