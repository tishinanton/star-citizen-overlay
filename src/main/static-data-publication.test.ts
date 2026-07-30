import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'

import type { BlueprintDetail, FactionReputation, MiningMaterial } from '../shared/contracts'
import {
  createDeterministicGzip,
  createStaticDataPublication,
  STATIC_DATA_PATHS
} from './static-data-publication'
import { generateSyntheticStaticDataPublication } from '../../test/fixtures/generate-static-data-v1'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/p171jwAAAABJRU5ErkJggg=='
const SYNTHETIC_FIXTURE_SHA256 = 'e49a5b8973a2f1d49eb274f4b6e79e5216a1d697b8325c815e86e67602b83996'

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

test('rejects PNG checksum, animation, interlacing, and data after IEND before upload', () => {
  const input = fixture()
  const bytes = Buffer.from(PNG.slice('data:image/png;base64,'.length), 'base64')

  const interlaced = Buffer.from(bytes)
  interlaced[28] = 1
  rewritePngChunkCrc(interlaced, 'IHDR')
  assert.throws(
    () =>
      createStaticDataPublication({
        ...input,
        icons: { 'icons/test.tif': toPngDataUrl(interlaced) }
      }),
    /unsupported PNG interlacing/
  )

  const animationChunk = createPngChunk('acTL', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]))
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

  const invalidChecksum = Buffer.from(bytes)
  invalidChecksum[54] ^= 0xff
  assert.throws(
    () =>
      createStaticDataPublication({
        ...input,
        icons: { 'icons/test.tif': toPngDataUrl(invalidChecksum) }
      }),
    /invalid PNG chunk checksum/
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

test('rejects corrupted PNG chunk CRCs before upload', () => {
  const input = fixture()
  const bytes = Buffer.from(PNG.slice('data:image/png;base64,'.length), 'base64')

  for (const type of ['IHDR', 'IDAT', 'IEND']) {
    const corrupted = Buffer.from(bytes)
    const offset = findPngChunk(corrupted, type)
    const checksumOffset = offset + 8 + corrupted.readUInt32BE(offset)
    corrupted[checksumOffset] = corrupted[checksumOffset] ^ 0xff
    assert.throws(
      () =>
        createStaticDataPublication({
          ...input,
          icons: { 'icons/test.tif': toPngDataUrl(corrupted) }
        }),
      /invalid PNG chunk checksum/
    )
  }
})

test('uses the build identifier for versioned dataset roots and blueprint records', () => {
  const publication = createStaticDataPublication(fixture())
  const blueprintDataset = readGzipJsonEntry<{
    gameVersion: string
    blueprints: Array<{ gameVersion: string }>
  }>(publication.archive, STATIC_DATA_PATHS.blueprints)
  const factionDataset = readGzipJsonEntry<{ gameVersion: string }>(
    publication.archive,
    STATIC_DATA_PATHS.factionReputation
  )

  assert.equal(blueprintDataset.gameVersion, '0.0.1-TEST')
  assert.equal(factionDataset.gameVersion, '0.0.1-TEST')
  assert.deepEqual(
    blueprintDataset.blueprints.map((blueprint) => blueprint.gameVersion),
    ['0.0.1-TEST', '0.0.1-TEST']
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
  const summary = JSON.parse(
    await readFile(
      join(process.cwd(), 'test', 'fixtures', 'static-data-v1.synthetic.summary.json'),
      'utf8'
    )
  ) as unknown
  const generated = generateSyntheticStaticDataPublication()
  assert.deepEqual(archive, generated.archive)
  assert.deepEqual(summary, {
    archiveBytes: generated.archive.byteLength,
    archiveSha256: generated.archiveSha256,
    manifestBytes: generated.manifestBytes,
    manifest: generated.manifest
  })
  assert.equal(archive.byteLength, 3_359)
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

function readGzipJsonEntry<T>(archive: Buffer, path: string): T {
  return JSON.parse(gunzipSync(readStoredZipEntry(archive, path)).toString('utf8')) as T
}

function readStoredZipEntry(archive: Buffer, path: string): Buffer {
  let offset = 0
  while (offset + 30 <= archive.byteLength && archive.readUInt32LE(offset) === 0x04034b50) {
    const compressedBytes = archive.readUInt32LE(offset + 18)
    const nameBytes = archive.readUInt16LE(offset + 26)
    const extraBytes = archive.readUInt16LE(offset + 28)
    const contentOffset = offset + 30 + nameBytes + extraBytes
    const entryPath = archive.toString('utf8', offset + 30, offset + 30 + nameBytes)
    if (entryPath === path) return archive.subarray(contentOffset, contentOffset + compressedBytes)
    offset = contentOffset + compressedBytes
  }
  throw new Error(`Missing ZIP entry: ${path}`)
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.byteLength)
  chunk.writeUInt32BE(data.byteLength, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.byteLength)
  return chunk
}

function rewritePngChunkCrc(bytes: Buffer, type: string): void {
  const offset = findPngChunk(bytes, type)
  const length = bytes.readUInt32BE(offset)
  bytes.writeUInt32BE(crc32(bytes.subarray(offset + 4, offset + 8 + length)), offset + 8 + length)
}

function findPngChunk(bytes: Buffer, expectedType: string): number {
  let offset = 8
  while (offset + 12 <= bytes.byteLength) {
    const length = bytes.readUInt32BE(offset)
    if (bytes.toString('ascii', offset + 4, offset + 8) === expectedType) return offset
    offset += 12 + length
  }
  throw new Error(`Missing PNG chunk: ${expectedType}`)
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
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
