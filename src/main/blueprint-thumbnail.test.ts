import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { BlueprintDetail } from '../shared/contracts'
import { BlueprintThumbnailService } from './blueprint-thumbnail'
import { renderGlbThumbnail } from './glb-thumbnail-renderer'

test('renders deterministic transparent PNG data from GLB geometry', async () => {
  const first = await renderGlbThumbnail(triangleGlb())
  const second = await renderGlbThumbnail(triangleGlb())

  assert.deepEqual(first, second)
  assert.deepEqual(first.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  assert.equal(first.readUInt32BE(16), 256)
  assert.equal(first.readUInt32BE(20), 256)
  assert.ok(first.length < 1024 * 1024)
})

test('rejects excessive raster overdraw before painting it', async () => {
  await assert.rejects(renderGlbThumbnail(triangleGlb(1_000)), /rasterization budget/)
})

test('deduplicates generation and invalidates cache by archive fingerprint', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-thumbnail-cache-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const archivePath = join(directory, 'Data.p4k')
  await writeFile(archivePath, 'archive')
  let fingerprint = 'archive-a'
  let generationCount = 0
  const png = await renderGlbThumbnail(triangleGlb())
  const service = new BlueprintThumbnailService({
    cacheDirectory: join(directory, 'cache'),
    temporaryDirectory: join(directory, 'temporary'),
    extractorPath: 'extractor.exe',
    converterPath: 'converter.exe',
    getGameDataArchive: () => ({ path: archivePath, channel: 'LIVE' }),
    fingerprint: async () => fingerprint,
    generate: async () => {
      generationCount += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return png
    },
    logError: () => undefined
  })

  const [first, concurrent] = await Promise.all([service.get(blueprint()), service.get(blueprint())])
  assert.equal(first.status, 'ready')
  assert.equal(concurrent.dataUrl, first.dataUrl)
  assert.equal(generationCount, 1)

  const cached = await service.get(blueprint())
  assert.equal(cached.status, 'ready')
  assert.match(cached.message, /cached/)
  assert.equal(generationCount, 1)

  fingerprint = 'archive-b'
  await service.get(blueprint())
  assert.equal(generationCount, 2)
})

test('gates skinned assets and contains generation failures', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-thumbnail-failure-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const archive = { path: join(directory, 'Data.p4k'), channel: 'LIVE' }
  await writeFile(archive.path, 'archive')
  let generationCount = 0
  const service = new BlueprintThumbnailService({
    cacheDirectory: join(directory, 'cache'),
    temporaryDirectory: join(directory, 'temporary'),
    extractorPath: 'extractor.exe',
    converterPath: 'converter.exe',
    getGameDataArchive: () => archive,
    fingerprint: async () => 'archive',
    generate: async () => {
      generationCount += 1
      throw new Error('conversion failed')
    },
    logError: () => undefined
  })

  const skinned = blueprint()
  skinned.renderAsset = {
    path: 'Objects/Characters/Human/armor/helmet.skin',
    format: 'skin'
  }
  assert.equal((await service.get(skinned)).status, 'unsupported')
  assert.equal(generationCount, 0)

  const failed = await service.get(blueprint())
  assert.equal(failed.status, 'error')
  assert.match(failed.message, /conversion failed/)
  assert.equal(failed.dataUrl, null)
})

test('keeps only the latest queued generation and preflights a missing converter', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-thumbnail-queue-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const archive = { path: join(directory, 'Data.p4k'), channel: 'LIVE' }
  await writeFile(archive.path, 'archive')
  const png = await renderGlbThumbnail(triangleGlb())
  let active = 0
  let maximumActive = 0
  let generationCount = 0
  let signalFirstStarted!: () => void
  let releaseFirst!: () => void
  const firstStarted = new Promise<void>((resolve) => {
    signalFirstStarted = resolve
  })
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const service = new BlueprintThumbnailService({
    cacheDirectory: join(directory, 'cache'),
    temporaryDirectory: join(directory, 'temporary'),
    extractorPath: 'extractor.exe',
    converterPath: 'converter.exe',
    getGameDataArchive: () => archive,
    fingerprint: async () => 'archive',
    generate: async () => {
      generationCount += 1
      active += 1
      maximumActive = Math.max(maximumActive, active)
      if (generationCount === 1) {
        signalFirstStarted()
        await firstRelease
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      return png
    },
    logError: () => undefined
  })
  const second = blueprint()
  second.id = 'helix'
  second.outputClass = 'Mining_Laser_GRIN_Helix_S1'
  second.renderAsset = {
    path: 'Objects/Spaceships/Weapons/GRIN/grin_min_hed_s1_3.cga',
    format: 'cga'
  }
  const third = blueprint()
  third.id = 'hofstede'
  third.outputClass = 'Mining_Laser_GRIN_Hofstede_S1'
  third.renderAsset = {
    path: 'Objects/Spaceships/Weapons/GRIN/grin_min_hed_s1_4.cga',
    format: 'cga'
  }
  const firstRequest = service.get(blueprint())
  await firstStarted
  const secondRequest = service.get(second)
  const thirdRequest = service.get(third)
  releaseFirst()
  const results = await Promise.all([firstRequest, secondRequest, thirdRequest])
  assert.equal(maximumActive, 1)
  assert.equal(generationCount, 2)
  assert.match(results[1].message, /superseded/)
  assert.equal(results[2].status, 'ready')

  const missingConverterService = new BlueprintThumbnailService({
    cacheDirectory: join(directory, 'missing-cache'),
    temporaryDirectory: join(directory, 'missing-temporary'),
    extractorPath: join(directory, 'missing-extractor.exe'),
    converterPath: join(directory, 'missing-converter.exe'),
    getGameDataArchive: () => archive,
    fingerprint: async () => 'archive',
    logError: () => undefined
  })
  const unavailable = await missingConverterService.get(blueprint())
  assert.equal(unavailable.status, 'unavailable')
  assert.match(unavailable.message, /Install Cryengine Converter/)
})

test('does not let an older cache probe supersede a newer selection', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-thumbnail-order-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const archive = { path: join(directory, 'Data.p4k'), channel: 'LIVE' }
  await writeFile(archive.path, 'archive')
  const png = await renderGlbThumbnail(triangleGlb())
  let fingerprintCalls = 0
  let signalFirstProbe!: () => void
  let releaseFirstProbe!: () => void
  const firstProbeStarted = new Promise<void>((resolve) => {
    signalFirstProbe = resolve
  })
  const firstProbeRelease = new Promise<void>((resolve) => {
    releaseFirstProbe = resolve
  })
  const generated: string[] = []
  const service = new BlueprintThumbnailService({
    cacheDirectory: join(directory, 'cache'),
    temporaryDirectory: join(directory, 'temporary'),
    extractorPath: 'extractor.exe',
    converterPath: 'converter.exe',
    getGameDataArchive: () => archive,
    fingerprint: async () => {
      fingerprintCalls += 1
      if (fingerprintCalls === 1) {
        signalFirstProbe()
        await firstProbeRelease
      }
      return 'archive'
    },
    generate: async ({ blueprint: selected }) => {
      generated.push(selected.outputClass)
      return png
    },
    logError: () => undefined
  })
  const older = blueprint()
  const newer = blueprint()
  newer.id = 'helix'
  newer.outputClass = 'Mining_Laser_GRIN_Helix_S1'
  newer.renderAsset = {
    path: 'Objects/Spaceships/Weapons/GRIN/grin_min_hed_s1_3.cga',
    format: 'cga'
  }

  const olderRequest = service.get(older)
  await firstProbeStarted
  const newerRequest = service.get(newer)
  const newerResult = await newerRequest
  releaseFirstProbe()
  const olderResult = await olderRequest

  assert.equal(newerResult.status, 'ready')
  assert.match(olderResult.message, /superseded/)
  assert.deepEqual(generated, ['Mining_Laser_GRIN_Helix_S1'])
})

test('drops queued work when a newer unsupported selection arrives', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-thumbnail-stale-queue-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const archive = { path: join(directory, 'Data.p4k'), channel: 'LIVE' }
  await writeFile(archive.path, 'archive')
  const png = await renderGlbThumbnail(triangleGlb())
  let generationCount = 0
  let signalStarted!: () => void
  let releaseActive!: () => void
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  const activeRelease = new Promise<void>((resolve) => {
    releaseActive = resolve
  })
  const service = new BlueprintThumbnailService({
    cacheDirectory: join(directory, 'cache'),
    temporaryDirectory: join(directory, 'temporary'),
    extractorPath: 'extractor.exe',
    converterPath: 'converter.exe',
    getGameDataArchive: () => archive,
    fingerprint: async () => 'archive',
    generate: async () => {
      generationCount += 1
      if (generationCount === 1) {
        signalStarted()
        await activeRelease
      }
      return png
    },
    logError: () => undefined
  })
  const queued = blueprint()
  queued.id = 'helix'
  queued.outputClass = 'Mining_Laser_GRIN_Helix_S1'
  queued.renderAsset = {
    path: 'Objects/Spaceships/Weapons/GRIN/grin_min_hed_s1_3.cga',
    format: 'cga'
  }
  const unsupported = blueprint()
  unsupported.id = 'helmet'
  unsupported.outputClass = 'Test_Helmet'
  unsupported.renderAsset = {
    path: 'Objects/Characters/Human/armor/test_helmet.skin',
    format: 'skin'
  }

  const activeRequest = service.get(blueprint())
  await started
  const queuedRequest = service.get(queued)
  assert.equal((await service.get(unsupported)).status, 'unsupported')
  releaseActive()
  await activeRequest
  const queuedResult = await queuedRequest

  assert.match(queuedResult.message, /superseded/)
  assert.equal(generationCount, 1)
})

function blueprint(): BlueprintDetail {
  return {
    id: 'arbor-mh1',
    key: 'BP_ARBOR_MH1',
    outputName: 'Arbor MH1 Mining Laser',
    outputClass: 'Mining_Laser_GRIN_Arbor_S1',
    outputType: 'WeaponMining',
    outputTypeLabel: 'Mining Laser',
    outputGrade: '1',
    craftTimeSeconds: 60,
    craftTimeLabel: '1 minute',
    availableByDefault: false,
    ingredientCount: 0,
    unlockingMissionCount: 0,
    ingredients: [],
    requirementGroups: [],
    unlockingMissions: [],
    gameVersion: '4.9-test',
    imageKey: null,
    renderAsset: {
      path: 'Objects/Spaceships/Weapons/GRIN/grin_min_hed_s1_2.cga',
      format: 'cga'
    },
    webUrl: null
  }
}

function triangleGlb(triangleCount = 1): Buffer {
  const positions = Buffer.alloc(9 * 4)
  ;[-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, index) =>
    positions.writeFloatLE(value, index * 4)
  )
  const normals = Buffer.alloc(9 * 4)
  ;[0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((value, index) =>
    normals.writeFloatLE(value, index * 4)
  )
  const indexBytes = triangleCount * 3 * 2
  const indices = Buffer.alloc(indexBytes + ((4 - (indexBytes % 4)) % 4))
  for (let index = 0; index < triangleCount; index += 1) {
    indices.writeUInt16LE(0, index * 6)
    indices.writeUInt16LE(1, index * 6 + 2)
    indices.writeUInt16LE(2, index * 6 + 4)
  }
  const binary = Buffer.concat([positions, normals, indices])
  const document = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length },
      { buffer: 0, byteOffset: positions.length, byteLength: normals.length },
      {
        buffer: 0,
        byteOffset: positions.length + normals.length,
        byteLength: indices.length
      }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: triangleCount * 3, type: 'SCALAR' }
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0
  }
  const jsonData = Buffer.from(JSON.stringify(document), 'utf8')
  const jsonPadding = Buffer.alloc((4 - (jsonData.length % 4)) % 4, 0x20)
  const json = Buffer.concat([jsonData, jsonPadding])
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(json.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)
  const binaryHeader = Buffer.alloc(8)
  binaryHeader.writeUInt32LE(binary.length, 0)
  binaryHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonHeader, json, binaryHeader, binary])
}
