import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'

import {
  createSyntheticStaticDataInput,
  SYNTHETIC_PNG
} from '../../test/fixtures/generate-static-data-v1'
import {
  createDeterministicGzip,
  createStaticDataPublication,
  STATIC_DATA_PATHS
} from './static-data-publication'

const SYNTHETIC_FIXTURE_SHA256 = '35cd4c4c39e8768499963dd5b50844aef758148be1f5ede192d2b867f6d0ab85'

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
  assert.equal(first.manifest.assets.length, 1)
  assert.equal(first.manifest.assets[0].width, 1)
  assert.equal(first.manifest.assets[0].height, 1)
  assert.match(first.manifest.assets[0].key, /^blueprint-icons\/[a-f0-9]{64}\.png$/)
  assert.match(first.manifest.assets[0].file, /^assets\/blueprint-icons\/[a-f0-9]{64}\.png$/)
  assert.equal(first.manifest.assets[0].file, `assets/${first.manifest.assets[0].key}`)
  assert.equal(first.archive.includes(Buffer.from('data:image/png;base64,')), false)
  assert.equal(
    first.archive.includes(Buffer.from(SYNTHETIC_PNG.slice('data:image/png;base64,'.length))),
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
        icons: { ...input.icons, 'icons/extra.tif': SYNTHETIC_PNG }
      }),
    /image keys do not match/
  )
})

test('rejects PNG animation, interlacing, and data after IEND before upload', () => {
  const input = fixture()
  const bytes = Buffer.from(SYNTHETIC_PNG.slice('data:image/png;base64,'.length), 'base64')

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
  const bytes = Buffer.from(SYNTHETIC_PNG.slice('data:image/png;base64,'.length), 'base64')

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
      new RegExp(`invalid ${type} chunk CRC`)
    )
  }
})

test('uses the build identifier for versioned datasets and blueprint records', () => {
  const publication = createStaticDataPublication(fixture())
  const blueprintDataset = readGzipJsonEntry<{
    gameVersion: string
    blueprints: Array<{ gameVersion: string }>
  }>(publication.archive, STATIC_DATA_PATHS.blueprints)
  const factionDataset = readGzipJsonEntry<{ gameVersion: string }>(
    publication.archive,
    STATIC_DATA_PATHS.factionReputation
  )

  assert.equal(publication.manifest.gameBuild, '0.0.1-TEST')
  assert.equal(publication.manifest.gameVersion, 'synthetic-branch')
  assert.equal(blueprintDataset.gameVersion, '0.0.1-TEST')
  assert.equal(factionDataset.gameVersion, '0.0.1-TEST')
  assert.deepEqual(
    blueprintDataset.blueprints.map((blueprint) => blueprint.gameVersion),
    ['0.0.1-TEST', '0.0.1-TEST']
  )
})

test('rejects blueprint records from a different build', () => {
  const input = fixture()
  const mismatched = {
    ...input.blueprints[0],
    gameVersion: input.source.gameVersion
  }

  assert.throws(
    () =>
      createStaticDataPublication({
        ...input,
        blueprints: [mismatched, ...input.blueprints.slice(1)]
      }),
    /expected build 0\.0\.1-TEST/
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
  const generated = createStaticDataPublication(fixture())
  assert.deepEqual(archive, generated.archive)
  assert.deepEqual(summary, {
    archiveBytes: generated.archive.byteLength,
    archiveSha256: generated.archiveSha256,
    manifestBytes: generated.manifestBytes,
    manifest: generated.manifest
  })
  assert.equal(archive.byteLength, 3_370)
  assert.equal(createHash('sha256').update(archive).digest('hex'), SYNTHETIC_FIXTURE_SHA256)
})

function fixture(): Parameters<typeof createStaticDataPublication>[0] {
  return createSyntheticStaticDataInput()
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

function toPngDataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`
}
