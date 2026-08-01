import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { loadMiningCatalog, type MiningCatalog } from './mining-catalog'

const execFileAsync = promisify(execFile)

function fillerGuid(prefix: number, index: number): string {
  return `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

/** Builds a minimal but structurally valid `mining` extractor payload (10/20/30 minimums). */
function buildValidCatalogPayload(gameVersion: string): Record<string, unknown> {
  const materials = Array.from({ length: 10 }, (_, i) => ({
    id: fillerGuid(1, i + 1),
    key: `Material_${i + 1}`,
    slug: `material-${i + 1}`,
    name: `Material ${i + 1}`,
    densityGramsPerCubicCentimeter: null,
    instability: null,
    resistance: null,
    defaultQuality: null,
    qualityLocationOverrides: [],
    quantizationBands: []
  }))
  const entities = Array.from({ length: 20 }, (_, i) => ({
    id: fillerGuid(2, i + 1),
    path: `libs/foundry/records/entities/mineable/mineablerock_fps_filler${i + 1}.xml`,
    key: `MineableRock_FPS_Filler${i + 1}`,
    signature: 1_000 + i,
    method: 'FPS',
    compositionId: null,
    depositName: null,
    minimumDistinctElements: null,
    composition: [
      {
        materialId: fillerGuid(1, (i % 10) + 1),
        minPercentage: 10,
        maxPercentage: 100,
        probability: 1,
        curveExponent: 1,
        qualityScale: 1,
        instability: null,
        resistance: null
      }
    ]
  }))
  const providers = Array.from({ length: 30 }, (_, i) => ({
    id: fillerGuid(3, i + 1),
    key: `HPP_Filler${i + 1}`,
    locationId: null,
    locationName: null,
    groups: [],
    areas: []
  }))
  return {
    schemaVersion: 1,
    gameVersion,
    materials,
    entities,
    locations: [],
    providers,
    clusters: [],
    warnings: []
  }
}

/** Writes a Node script that prints `payload` to stdout, ignoring its argv. */
async function writeExtractorScript(dir: string, name: string, payload: unknown): Promise<string> {
  const scriptPath = join(dir, name)
  await writeFile(
    scriptPath,
    `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});\n`,
    'utf8'
  )
  return scriptPath
}

/** Writes a Node script that always exits non-zero, so any invocation fails the test loudly. */
async function writeTrapExtractorScript(dir: string): Promise<string> {
  const scriptPath = join(dir, 'trap.js')
  await writeFile(
    scriptPath,
    "process.stderr.write('extractor should not have been invoked'); process.exit(1);\n",
    'utf8'
  )
  return scriptPath
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mining-catalog-cache-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('serves a fingerprint/channel-matching cache hit without invoking the extractor', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-catalog.json')
    const catalog = buildValidCatalogPayload('4.9.188.23497-LIVE')
    const savedAt = '2024-01-01T00:00:00.000Z'
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 2,
        savedAt,
        source: { archiveFingerprint: 'fp-1', channel: 'LIVE' },
        catalog
      }),
      'utf8'
    )
    const trapPath = await writeTrapExtractorScript(dir)

    const result = await loadMiningCatalog({
      cachePath,
      extractorPath: process.execPath,
      archivePath: trapPath,
      archiveFingerprint: 'fp-1',
      channel: 'LIVE'
    })

    assert.equal(result.fromCache, true)
    assert.equal(result.updatedAt, savedAt)
    assert.equal(result.cacheWarning, null)
    assert.equal(result.catalog.gameVersion, '4.9.188.23497-LIVE')
    assert.equal(result.catalog.materials.length, 10)
  })
})

test('misses the cache and re-extracts when the archive fingerprint changes', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-catalog.json')
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 2,
        savedAt: '2024-01-01T00:00:00.000Z',
        source: { archiveFingerprint: 'fp-old', channel: 'LIVE' },
        catalog: buildValidCatalogPayload('4.0.0-LIVE')
      }),
      'utf8'
    )
    const freshPayload = buildValidCatalogPayload('4.1.0-LIVE')
    const scriptPath = await writeExtractorScript(dir, 'extractor.js', freshPayload)

    const result = await loadMiningCatalog({
      cachePath,
      extractorPath: process.execPath,
      archivePath: scriptPath,
      archiveFingerprint: 'fp-new',
      channel: 'LIVE'
    })

    assert.equal(result.fromCache, false)
    assert.equal(result.catalog.gameVersion, '4.1.0-LIVE')

    const written = JSON.parse(await readFile(cachePath, 'utf8'))
    assert.equal(written.source.archiveFingerprint, 'fp-new')
    assert.equal(written.catalog.gameVersion, '4.1.0-LIVE')
  })
})

test('misses the cache and re-extracts when the channel changes', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-catalog.json')
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 2,
        savedAt: '2024-01-01T00:00:00.000Z',
        source: { archiveFingerprint: 'fp-1', channel: 'LIVE' },
        catalog: buildValidCatalogPayload('4.0.0-LIVE')
      }),
      'utf8'
    )
    const freshPayload = buildValidCatalogPayload('4.0.0-PTU')
    const scriptPath = await writeExtractorScript(dir, 'extractor.js', freshPayload)

    const result = await loadMiningCatalog({
      cachePath,
      extractorPath: process.execPath,
      archivePath: scriptPath,
      archiveFingerprint: 'fp-1',
      channel: 'PTU'
    })

    assert.equal(result.fromCache, false)
    assert.equal(result.catalog.gameVersion, '4.0.0-PTU')
  })
})

test('misses the cache and re-extracts when the cache schema version is stale', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-catalog.json')
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        savedAt: '2024-01-01T00:00:00.000Z',
        source: { archiveFingerprint: 'fp-1', channel: 'LIVE' },
        catalog: buildValidCatalogPayload('4.0.0-LIVE')
      }),
      'utf8'
    )
    const freshPayload = buildValidCatalogPayload('4.2.0-LIVE')
    const scriptPath = await writeExtractorScript(dir, 'extractor.js', freshPayload)

    const result = await loadMiningCatalog({
      cachePath,
      extractorPath: process.execPath,
      archivePath: scriptPath,
      archiveFingerprint: 'fp-1',
      channel: 'LIVE'
    })

    assert.equal(result.fromCache, false)
    assert.equal(result.catalog.gameVersion, '4.2.0-LIVE')
  })
})

test('re-extracts on a forced refresh even when the cache otherwise matches', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-catalog.json')
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 2,
        savedAt: '2024-01-01T00:00:00.000Z',
        source: { archiveFingerprint: 'fp-1', channel: 'LIVE' },
        catalog: buildValidCatalogPayload('4.0.0-LIVE')
      }),
      'utf8'
    )
    const freshPayload = buildValidCatalogPayload('4.0.0-LIVE-refreshed')
    const scriptPath = await writeExtractorScript(dir, 'extractor.js', freshPayload)

    const result = await loadMiningCatalog({
      cachePath,
      extractorPath: process.execPath,
      archivePath: scriptPath,
      archiveFingerprint: 'fp-1',
      channel: 'LIVE',
      forceRefresh: true
    })

    assert.equal(result.fromCache, false)
    assert.equal(result.catalog.gameVersion, '4.0.0-LIVE-refreshed')
  })
})

test('falls back to extraction with a cacheWarning when the cache file is corrupt', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-catalog.json')
    await writeFile(cachePath, '{ not valid json', 'utf8')
    const freshPayload = buildValidCatalogPayload('4.3.0-LIVE')
    const scriptPath = await writeExtractorScript(dir, 'extractor.js', freshPayload)

    const result = await loadMiningCatalog({
      cachePath,
      extractorPath: process.execPath,
      archivePath: scriptPath,
      archiveFingerprint: 'fp-1',
      channel: 'LIVE'
    })

    assert.equal(result.fromCache, false)
    assert.ok(result.cacheWarning)
    assert.equal(result.catalog.gameVersion, '4.3.0-LIVE')
  })
})

test('falls back to extraction with a cacheWarning when the cached catalog fails strict validation', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-catalog.json')
    const invalidCatalog = buildValidCatalogPayload('4.0.0-LIVE')
    // Corrupt the cached catalog itself so re-validation on read must reject it.
    ;(invalidCatalog.materials as unknown[]) = (invalidCatalog.materials as unknown[]).slice(0, 2)
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 2,
        savedAt: '2024-01-01T00:00:00.000Z',
        source: { archiveFingerprint: 'fp-1', channel: 'LIVE' },
        catalog: invalidCatalog
      }),
      'utf8'
    )
    const freshPayload = buildValidCatalogPayload('4.4.0-LIVE')
    const scriptPath = await writeExtractorScript(dir, 'extractor.js', freshPayload)

    const result = await loadMiningCatalog({
      cachePath,
      extractorPath: process.execPath,
      archivePath: scriptPath,
      archiveFingerprint: 'fp-1',
      channel: 'LIVE'
    })

    assert.equal(result.fromCache, false)
    assert.ok(result.cacheWarning)
    assert.match(result.cacheWarning ?? '', /complete mining material catalog/)
    assert.equal(result.catalog.gameVersion, '4.4.0-LIVE')
  })
})

test('extracts and writes a fresh cache when no cache file exists yet', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-catalog.json')
    const freshPayload = buildValidCatalogPayload('4.5.0-LIVE')
    const scriptPath = await writeExtractorScript(dir, 'extractor.js', freshPayload)

    const result = await loadMiningCatalog({
      cachePath,
      extractorPath: process.execPath,
      archivePath: scriptPath,
      archiveFingerprint: 'fp-1',
      channel: 'LIVE'
    })

    assert.equal(result.fromCache, false)
    assert.equal(result.cacheWarning, null)
    const written = JSON.parse(await readFile(cachePath, 'utf8')) as {
      catalog: MiningCatalog
      source: { archiveFingerprint: string; channel: string }
    }
    assert.equal(written.source.archiveFingerprint, 'fp-1')
    assert.equal(written.catalog.gameVersion, '4.5.0-LIVE')
  })
})

test('surfaces an explicit error when the cache cannot be written', async () => {
  await withTempDir(async (dir) => {
    // Make the cache's parent directory path collide with a plain file, so `mkdir(dirname, {
    // recursive: true })` fails loudly instead of the write being silently swallowed.
    const blockerFile = join(dir, 'blocker')
    await writeFile(blockerFile, 'not a directory', 'utf8')
    const cachePath = join(blockerFile, 'nested', 'mining-catalog.json')
    const freshPayload = buildValidCatalogPayload('4.6.0-LIVE')
    const scriptPath = await writeExtractorScript(dir, 'extractor.js', freshPayload)

    await assert.rejects(
      loadMiningCatalog({
        cachePath,
        extractorPath: process.execPath,
        archivePath: scriptPath,
        archiveFingerprint: 'fp-1',
        channel: 'LIVE'
      })
    )
  })
})

test('surfaces an explicit error when extraction itself fails (no silent fallback)', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-catalog.json')
    const trapPath = await writeTrapExtractorScript(dir)

    await assert.rejects(
      loadMiningCatalog({
        cachePath,
        extractorPath: process.execPath,
        archivePath: trapPath,
        archiveFingerprint: 'fp-1',
        channel: 'LIVE'
      }),
      /Installed game mining data could not be extracted/
    )
  })
})

// Sanity check that the Node-as-extractor test trick used above actually models a real
// child-process invocation (not just a direct function call), so the cache/extraction branch
// coverage above reflects the real `execFile` code path.
test('the extractor test harness actually spawns a child process', async () => {
  await withTempDir(async (dir) => {
    const scriptPath = await writeExtractorScript(dir, 'extractor.js', { probe: true })
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, 'mining'])
    assert.deepEqual(JSON.parse(stdout), { probe: true })
  })
})
