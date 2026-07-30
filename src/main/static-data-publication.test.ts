import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import type { BlueprintDetail, FactionReputation, MiningMaterial } from '../shared/contracts'
import {
  createDeterministicGzip,
  createStaticDataPublication,
  STATIC_DATA_PATHS
} from './static-data-publication'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7Z1iWQAAAABJRU5ErkJggg=='
const SYNTHETIC_FIXTURE_SHA256 = 'b71c2c84d82732529fcd6f23d51a2c84be2fbf3811a4d792d11702c16792a06b'

test('creates a byte-stable publication with raw declared PNG assets', () => {
  const first = createStaticDataPublication(fixture())
  const second = createStaticDataPublication({
    ...fixture(),
    materials: [...fixture().materials].reverse(),
    blueprints: [...fixture().blueprints].reverse(),
    factions: [...fixture().factions].reverse()
  })

  assert.deepEqual(first.archive, second.archive)
  assert.equal(first.archiveSha256, second.archiveSha256)
  const resources = Object.fromEntries(
    first.manifest.resources.map((resource) => [resource.name, resource])
  )
  assert.equal(resources.signatures.file, STATIC_DATA_PATHS.signatures)
  assert.equal(resources.blueprints.recordCount, 2)
  assert.equal(first.manifest.contractVersion, 1)
  assert.equal(first.manifest.gameBuild, '0.0.1-TEST')
  assert.equal(first.manifest.gameVersion, 'synthetic-branch')
  assert.equal(first.manifest.assets.length, 1)
  assert.equal(first.manifest.assets[0].width, 1)
  assert.equal(first.manifest.assets[0].height, 1)
  assert.match(first.manifest.assets[0].key, /^blueprint-icons\/[a-f0-9]{64}\.png$/)
  assert.match(first.manifest.assets[0].file, /^assets\/blueprint-icons\/[a-f0-9]{64}\.png$/)
  assert.equal(first.manifest.assets[0].file, `assets/${first.manifest.assets[0].key}`)
  assert.equal(first.archive.includes(Buffer.from('data:image/png;base64,')), false)
  assert.equal(
    first.archive.includes(Buffer.from(PNG.slice('data:image/png;base64,'.length))),
    false
  )
})

test('rejects missing and unreferenced icon declarations', () => {
  const input = fixture()
  assert.throws(
    () => createStaticDataPublication({ ...input, icons: {} }),
    /image keys do not match/
  )
  assert.throws(
    () =>
      createStaticDataPublication({
        ...input,
        icons: { ...input.icons, 'icons/extra.tif': PNG }
      }),
    /image keys do not match/
  )
})

test('rejects blueprint records from another game build', () => {
  const input = fixture()
  assert.throws(
    () =>
      createStaticDataPublication({
        ...input,
        blueprints: input.blueprints.map((blueprint) => ({
          ...blueprint,
          gameVersion: 'different-build'
        }))
      }),
    /do not match the selected game build/
  )
})

test('rejects PNG animation, interlacing, and data after IEND before upload', () => {
  const input = fixture()
  const bytes = Buffer.from(PNG.slice('data:image/png;base64,'.length), 'base64')

  const interlaced = Buffer.from(bytes)
  interlaced[28] = 1
  assert.throws(
    () =>
      createStaticDataPublication({
        ...input,
        icons: { 'icons/test.tif': toPngDataUrl(interlaced) }
      }),
    /unsupported PNG interlacing/
  )

  const animationChunk = Buffer.from([
    0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0
  ])
  assert.throws(
    () =>
      createStaticDataPublication({
        ...input,
        icons: {
          'icons/test.tif': toPngDataUrl(
            Buffer.concat([bytes.subarray(0, -12), animationChunk, bytes.subarray(-12)])
          )
        }
      }),
    /unsupported PNG animation/
  )

  assert.throws(
    () =>
      createStaticDataPublication({
        ...input,
        icons: { 'icons/test.tif': toPngDataUrl(Buffer.concat([bytes, Buffer.from([0])])) }
      }),
    /invalid PNG ending/
  )
})

test('normalizes gzip headers for deterministic output', () => {
  const value = Buffer.from('synthetic fixture')
  const first = createDeterministicGzip(value)
  const second = createDeterministicGzip(value)
  assert.deepEqual(first, second)
  assert.deepEqual([...first.subarray(4, 8)], [0, 0, 0, 0])
  assert.equal(first[9], 255)
})

test('pins the API compatibility fixture byte-for-byte', async () => {
  const archive = await readFile(
    join(process.cwd(), 'test', 'fixtures', 'static-data-v1.synthetic.zip')
  )
  assert.equal(archive.byteLength, 3_362)
  assert.equal(createHash('sha256').update(archive).digest('hex'), SYNTHETIC_FIXTURE_SHA256)
})

function fixture(): Parameters<typeof createStaticDataPublication>[0] {
  return {
    releaseId: '33333333-3333-4333-8333-333333333333',
    generatedAt: '2026-07-30T14:00:00.000Z',
    source: {
      gameBuild: '0.0.1-TEST',
      gameVersion: 'synthetic-branch',
      channel: 'TEST',
      archiveBytes: 123_456,
      archiveModifiedAt: '2026-07-30T13:00:00.000Z',
      desktopVersion: '0.2.0'
    },
    materials: [material('ore-b'), material('ore-a')],
    blueprints: [blueprint('blueprint-b', null), blueprint('blueprint-a', 'icons/test.tif')],
    icons: { 'icons/test.tif': PNG },
    factions: [faction('faction-b'), faction('faction-a')]
  }
}

function material(id: string): MiningMaterial {
  return {
    id,
    commodityId: id,
    name: id,
    displayName: id.toUpperCase(),
    signature: 4_000,
    methods: ['FPS', 'Ship'],
    sourceUrl: `https://example.test/commodities/${id}`
  }
}

function blueprint(id: string, imageKey: string | null): BlueprintDetail {
  return {
    id,
    key: id.toUpperCase(),
    outputName: id,
    outputClass: `${id}-class`,
    outputType: 'Synthetic',
    outputTypeLabel: 'Synthetic item',
    outputGrade: null,
    craftTimeSeconds: 60,
    craftTimeLabel: '1 minute',
    availableByDefault: false,
    ingredientCount: 1,
    unlockingMissionCount: 1,
    ingredients: [
      {
        name: 'Synthetic alloy',
        kind: 'resource',
        quantity: 10,
        quantityScu: 0.1,
        webUrl: null
      }
    ],
    gameVersion: '0.0.1-TEST',
    imageKey,
    webUrl: null,
    requirementGroups: [
      {
        key: 'group-a',
        name: 'Group A',
        requiredCount: 1,
        ingredients: [
          {
            name: 'Synthetic alloy',
            kind: 'resource',
            quantity: 10,
            quantityScu: 0.1,
            webUrl: null,
            minQuality: 0.5
          }
        ]
      }
    ],
    unlockingMissions: [
      {
        id: 'mission-a',
        title: 'Synthetic mission',
        missionType: 'Test',
        contractType: null,
        provider: null,
        minimumReputation: null,
        reputationVaries: false,
        starSystems: ['System B', 'System A'],
        chance: 1,
        webUrl: null
      }
    ]
  }
}

function faction(id: string): FactionReputation {
  return {
    id,
    key: id.toUpperCase(),
    name: id,
    description: null,
    alignment: 'unknown',
    isNpc: false,
    hidden: false,
    headquarters: null,
    focus: null,
    scopeCount: 1,
    standingCount: 1,
    scopes: [
      {
        id: `${id}-scope`,
        name: 'Synthetic scope',
        description: null,
        initialReputation: 0,
        reputationCeiling: 10_000,
        standings: [
          {
            id: `${id}-standing`,
            name: 'Synthetic standing',
            minReputation: 0,
            driftReputation: 0,
            driftTimeHours: 0,
            gated: false,
            perkDescription: null
          }
        ]
      }
    ]
  }
}

function toPngDataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`
}
