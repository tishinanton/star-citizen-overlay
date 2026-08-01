import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildMaterialsFromCatalog, loadMiningData } from './mining-data'
import type { MiningCatalog, MiningCatalogEntity, MiningCatalogMaterial } from './mining-catalog'

function guid(prefix: string, index: number): string {
  return `${prefix.padStart(8, '0').slice(0, 8)}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function material(
  overrides: Partial<MiningCatalogMaterial> & { id: string }
): MiningCatalogMaterial {
  return {
    key: overrides.key ?? overrides.id,
    slug: overrides.slug ?? overrides.id,
    name: overrides.name ?? overrides.id,
    densityGramsPerCubicCentimeter: null,
    instability: null,
    resistance: null,
    defaultQuality: null,
    qualityLocationOverrides: [],
    quantizationBands: [],
    ...overrides
  }
}

function entity(
  overrides: Partial<MiningCatalogEntity> & {
    id: string
    path: string
    method: MiningCatalogEntity['method']
    signature: number
    materialId: string
  }
): MiningCatalogEntity {
  return {
    key: overrides.id,
    compositionId: null,
    depositName: null,
    minimumDistinctElements: null,
    ...overrides,
    composition: overrides.composition ?? [
      {
        materialId: overrides.materialId,
        minPercentage: 50,
        maxPercentage: 100,
        probability: 1,
        curveExponent: 1,
        qualityScale: 1,
        instability: null,
        resistance: null
      }
    ]
  }
}

function emptyCatalog(overrides: Partial<MiningCatalog> = {}): MiningCatalog {
  return {
    schemaVersion: 1,
    gameVersion: '4.9.188.23497-LIVE',
    materials: [],
    entities: [],
    locations: [],
    providers: [],
    clusters: [],
    warnings: [],
    ...overrides
  }
}

test('buildMaterialsFromCatalog derives a stable Hadanite material from its own composition', () => {
  const hadanite = material({
    id: guid('1', 1),
    key: 'Hadanite',
    slug: 'hadanite',
    name: 'Hadanite'
  })
  const catalog = emptyCatalog({
    materials: [hadanite],
    entities: [
      entity({
        id: guid('2', 1),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_hadanite.xml',
        method: 'FPS',
        signature: 3_000,
        materialId: hadanite.id
      })
    ]
  })

  const materials = buildMaterialsFromCatalog(catalog)
  assert.equal(materials.length, 1)
  const [result] = materials
  // 'hadanite' is a pre-existing GAME_COMMODITY_IDS mapping, so the id must stay 'hadanite' (stable
  // across the upgrade), not fall back to the catalog's own slug.
  assert.equal(result.id, 'hadanite')
  assert.equal(result.commodityId, 'hadanite')
  assert.equal(result.name, 'Hadanite')
  assert.equal(result.signature, 3_000)
  assert.deepEqual(result.methods, ['FPS'])
  assert.equal(result.catalogMaterialId, hadanite.id)
})

test('buildMaterialsFromCatalog falls back to the catalog slug for materials with no existing Wiki mapping', () => {
  const novel = material({
    id: guid('1', 2),
    key: 'NovelOre',
    slug: 'novel-ore',
    name: 'Novel Ore'
  })
  const catalog = emptyCatalog({
    materials: [novel],
    entities: [
      entity({
        id: guid('2', 2),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_novelore.xml',
        method: 'FPS',
        signature: 4_200,
        materialId: novel.id
      })
    ]
  })

  const [result] = buildMaterialsFromCatalog(catalog)
  assert.equal(result.id, 'novel-ore')
  assert.equal(result.commodityId, 'novel-ore')
})

test('buildMaterialsFromCatalog assigns stable suffixed ids to multi-method variants', () => {
  const hadanite = material({
    id: guid('1', 3),
    key: 'Hadanite',
    slug: 'hadanite',
    name: 'Hadanite'
  })
  const catalog = emptyCatalog({
    materials: [hadanite],
    entities: [
      entity({
        id: guid('2', 3),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_hadanite.xml',
        method: 'FPS',
        signature: 3_000,
        materialId: hadanite.id
      }),
      entity({
        id: guid('2', 4),
        path: 'libs/foundry/records/entities/mineable/mineablerock_asteroidcommon_hadanite.xml',
        method: 'Ship',
        signature: 3_100,
        materialId: hadanite.id
      })
    ]
  })

  const materials = buildMaterialsFromCatalog(catalog)
  assert.equal(materials.length, 2)
  const ship = materials.find((entry) => entry.methods.includes('Ship'))
  const fps = materials.find((entry) => entry.methods.includes('FPS'))
  assert.ok(ship && fps)
  // Ship sorts first per PRIMARY_METHOD_ORDER, keeps the bare commodity id; FPS gets a suffix.
  assert.equal(ship.id, 'hadanite')
  assert.equal(fps.id, 'hadanite--fps')
  assert.equal(ship.catalogMaterialId, hadanite.id)
  assert.equal(fps.catalogMaterialId, hadanite.id)
})

test('buildMaterialsFromCatalog merges same-signature variants sharing one canonical key and method set', () => {
  const beradom = material({ id: guid('1', 5), key: 'Beradom', slug: 'beradom', name: 'Beradom' })
  const catalog = emptyCatalog({
    materials: [beradom],
    entities: [
      entity({
        id: guid('2', 5),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_beradom_large.xml',
        method: 'FPS',
        signature: 4_000,
        materialId: beradom.id
      }),
      entity({
        id: guid('2', 6),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_beradom_small.xml',
        method: 'FPS',
        signature: 4_000,
        materialId: beradom.id
      })
    ]
  })

  const materials = buildMaterialsFromCatalog(catalog)
  assert.equal(materials.length, 1)
  assert.equal(materials[0].signature, 4_000)
})

test('buildMaterialsFromCatalog throws when the same canonical key/method disagrees on signature', () => {
  const beradom = material({ id: guid('1', 7), key: 'Beradom', slug: 'beradom', name: 'Beradom' })
  const catalog = emptyCatalog({
    materials: [beradom],
    entities: [
      entity({
        id: guid('2', 7),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_beradom_large.xml',
        method: 'FPS',
        signature: 4_000,
        materialId: beradom.id
      }),
      entity({
        id: guid('2', 8),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_beradom_small.xml',
        method: 'FPS',
        signature: 4_001,
        materialId: beradom.id
      })
    ]
  })

  assert.throws(() => buildMaterialsFromCatalog(catalog), /Conflicting FPS signatures/)
})

test('buildMaterialsFromCatalog throws when the same canonical key/method resolves to different materials', () => {
  const beradom = material({ id: guid('1', 9), key: 'Beradom', slug: 'beradom', name: 'Beradom' })
  const feynmaline = material({
    id: guid('1', 10),
    key: 'Feynmaline',
    slug: 'feynmaline',
    name: 'Feynmaline'
  })
  const catalog = emptyCatalog({
    materials: [beradom, feynmaline],
    entities: [
      entity({
        id: guid('2', 9),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_beradom_large.xml',
        method: 'FPS',
        signature: 4_000,
        materialId: beradom.id
      }),
      entity({
        id: guid('2', 10),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_beradom_small.xml',
        method: 'FPS',
        signature: 4_000,
        materialId: feynmaline.id
      })
    ]
  })

  assert.throws(() => buildMaterialsFromCatalog(catalog), /resolve to different materials/)
})

// Regression test: verified against the installed LIVE Data.p4k, where
// MineableRock_FPS_Carinite_Pure_small is a genuinely distinct sellable material ("Carinite
// (Pure)") from plain Carinite, despite sharing the "carinite" filename stem. This must NOT
// trip the same-key/different-material guard above; the canonical-key regex keeps "_pure" as
// part of the key so the two remain distinct materials instead of throwing.
test('buildMaterialsFromCatalog treats a "_pure" FPS variant as a distinct material, not a conflict', () => {
  const carinite = material({ id: guid('1', 20), key: 'Carinite', slug: 'carinite', name: 'Carinite' })
  const carinitePure = material({
    id: guid('1', 21),
    key: 'CarinitePure',
    slug: 'carinite-pure',
    name: 'Carinite (Pure)'
  })
  const catalog = emptyCatalog({
    materials: [carinite, carinitePure],
    entities: [
      entity({
        id: guid('2', 20),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_carinite.xml',
        method: 'FPS',
        signature: 3_000,
        materialId: carinite.id
      }),
      entity({
        id: guid('2', 21),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_carinite_large.xml',
        method: 'FPS',
        signature: 3_000,
        materialId: carinite.id
      }),
      entity({
        id: guid('2', 22),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_carinite_pure_small.xml',
        method: 'FPS',
        signature: 3_000,
        materialId: carinitePure.id
      })
    ]
  })

  const materials = buildMaterialsFromCatalog(catalog)
  assert.equal(materials.length, 2)
  const bySlug = new Map(materials.map((entry) => [entry.commodityId, entry]))
  assert.equal(bySlug.get('carinite')?.catalogMaterialId, carinite.id)
  assert.equal(bySlug.get('carinite-pure')?.catalogMaterialId, carinitePure.id)
})

test('buildMaterialsFromCatalog throws for an entity with no composition', () => {
  const beradom = material({ id: guid('1', 11), key: 'Beradom', slug: 'beradom', name: 'Beradom' })
  const catalog = emptyCatalog({
    materials: [beradom],
    entities: [
      entity({
        id: guid('2', 11),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_beradom_large.xml',
        method: 'FPS',
        signature: 4_000,
        materialId: beradom.id,
        composition: []
      })
    ]
  })

  assert.throws(() => buildMaterialsFromCatalog(catalog), /no usable composition/)
})

test('buildMaterialsFromCatalog throws when composition references an unknown material', () => {
  const beradom = material({ id: guid('1', 12), key: 'Beradom', slug: 'beradom', name: 'Beradom' })
  const catalog = emptyCatalog({
    materials: [beradom],
    entities: [
      entity({
        id: guid('2', 12),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_beradom_large.xml',
        method: 'FPS',
        signature: 4_000,
        materialId: guid('9', 999)
      })
    ]
  })

  assert.throws(() => buildMaterialsFromCatalog(catalog), /unresolved material identifier/)
})

test('buildMaterialsFromCatalog skips non-canonical/template entity paths', () => {
  const beradom = material({ id: guid('1', 13), key: 'Beradom', slug: 'beradom', name: 'Beradom' })
  const catalog = emptyCatalog({
    materials: [beradom],
    entities: [
      entity({
        id: guid('2', 13),
        path: 'libs/foundry/records/entities/mineable/mineablerock_fps_template.xml',
        method: 'FPS',
        signature: 4_000,
        materialId: beradom.id
      })
    ]
  })

  assert.deepEqual(buildMaterialsFromCatalog(catalog), [])
})

// --- loadMiningData integration: game path vs. Wiki fallback --------------------------------

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mining-data-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function writeExtractorScript(dir: string, name: string, payload: unknown): Promise<string> {
  const scriptPath = join(dir, name)
  await writeFile(
    scriptPath,
    `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});\n`,
    'utf8'
  )
  return scriptPath
}

async function writeTrapExtractorScript(dir: string): Promise<string> {
  const scriptPath = join(dir, 'trap.js')
  await writeFile(
    scriptPath,
    "process.stderr.write('extractor should not have been invoked'); process.exit(1);\n",
    'utf8'
  )
  return scriptPath
}

function fillerGuid(prefix: number, index: number): string {
  return `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

/** A structurally valid `mining` extractor JSON payload meeting the 10/20/30 minimums. */
function buildValidCatalogJsonPayload(gameVersion: string): Record<string, unknown> {
  const hadaniteMaterialId = fillerGuid(1, 1)
  // One material per entity (20 total) so distinct canonical entity keys never collide onto the
  // same catalog-slug-derived commodity id - that would be a genuine duplicate-id conflict the
  // production code correctly rejects, which isn't what these fixture-plumbing tests are for.
  const materials = Array.from({ length: 20 }, (_, i) => ({
    id: i === 0 ? hadaniteMaterialId : fillerGuid(1, i + 1),
    key: i === 0 ? 'Hadanite' : `Material_${i + 1}`,
    slug: i === 0 ? 'hadanite' : `material-${i + 1}`,
    name: i === 0 ? 'Hadanite' : `Material ${i + 1}`,
    densityGramsPerCubicCentimeter: null,
    instability: null,
    resistance: null,
    defaultQuality: null,
    qualityLocationOverrides: [],
    quantizationBands: []
  }))
  const entities = Array.from({ length: 20 }, (_, i) => ({
    id: fillerGuid(2, i + 1),
    path:
      i === 0
        ? 'libs/foundry/records/entities/mineable/mineablerock_fps_hadanite.xml'
        : `libs/foundry/records/entities/mineable/mineablerock_fps_filler${i}.xml`,
    key: i === 0 ? 'MineableRock_FPS_Hadanite' : `MineableRock_FPS_Filler${i}`,
    signature: i === 0 ? 3_000 : 1_000 + i,
    method: 'FPS',
    compositionId: null,
    depositName: null,
    minimumDistinctElements: null,
    composition: [
      {
        materialId: i === 0 ? hadaniteMaterialId : fillerGuid(1, i + 1),
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

function withFetchGuard<T>(run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error('Star Citizen Wiki commodity list should not be requested on the game path.')
  }) as typeof fetch
  return run().finally(() => {
    globalThis.fetch = originalFetch
  })
}

function withFetchStub<T>(
  responder: () => { ok: boolean; status: number; json: () => Promise<unknown> },
  run: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.resolve(responder())) as unknown as typeof fetch
  return run().finally(() => {
    globalThis.fetch = originalFetch
  })
}

const VALID_COMMODITY_LIST_RESPONSE = {
  data: [
    {
      slug: 'agricium-ore',
      name: 'Agricium (Ore)',
      display_name: 'Agricium (Ore)',
      signature: 3_885,
      methods: ['Ship'],
      link: 'https://api.star-citizen.wiki/api/commodities/agricium-ore'
    }
  ]
}

test('loadMiningData builds materials from the local catalog without any Wiki list request', async () => {
  await withTempDir(async (dir) => {
    const scriptPath = await writeExtractorScript(
      dir,
      'extractor.js',
      buildValidCatalogJsonPayload('4.9.188.23497-LIVE')
    )
    const cachePath = join(dir, 'mining-signatures.json')
    const miningCatalogCachePath = join(dir, 'mining-catalog.json')

    await withFetchGuard(async () => {
      const result = await loadMiningData({
        cachePath,
        miningCatalogCachePath,
        extractorPath: process.execPath,
        gameDataArchive: { path: scriptPath, channel: 'LIVE' }
      })

      assert.equal(result.status.state, 'game')
      assert.ok(result.catalog)
      assert.equal(result.catalog?.gameVersion, '4.9.188.23497-LIVE')
      const hadanite = result.materials.find((entry) => entry.id === 'hadanite')
      assert.ok(hadanite)
      assert.equal(hadanite?.signature, 3_000)
      assert.equal(hadanite?.catalogMaterialId, fillerGuid(1, 1))

      const writtenCache = JSON.parse(await readFile(cachePath, 'utf8')) as {
        source: { kind: string; archiveFingerprint: string; channel: string }
      }
      assert.equal(writtenCache.source.kind, 'game')
      assert.equal(writtenCache.source.channel, 'LIVE')
      assert.equal(typeof writtenCache.source.archiveFingerprint, 'string')
      assert.ok(writtenCache.source.archiveFingerprint.length > 0)
    })
  })
})

test('loadMiningData falls back to the Wiki commodity list when local extraction fails', async () => {
  await withTempDir(async (dir) => {
    const trapPath = await writeTrapExtractorScript(dir)
    const cachePath = join(dir, 'mining-signatures.json')
    const miningCatalogCachePath = join(dir, 'mining-catalog.json')

    await withFetchStub(
      () => ({ ok: true, status: 200, json: () => Promise.resolve(VALID_COMMODITY_LIST_RESPONSE) }),
      async () => {
        const result = await loadMiningData({
          cachePath,
          miningCatalogCachePath,
          extractorPath: process.execPath,
          gameDataArchive: { path: trapPath, channel: 'LIVE' }
        })

        assert.equal(result.status.state, 'live')
        assert.equal(result.catalog, null)
        assert.ok(
          result.status.message.includes('Installed game mining data could not be extracted')
        )
        assert.equal(result.materials.length, 1)
        assert.equal(result.materials[0].id, 'agricium-ore')
      }
    )
  })
})

test('loadMiningData uses the Wiki commodity list directly when no archive is configured', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-signatures.json')
    const miningCatalogCachePath = join(dir, 'mining-catalog.json')

    await withFetchStub(
      () => ({ ok: true, status: 200, json: () => Promise.resolve(VALID_COMMODITY_LIST_RESPONSE) }),
      async () => {
        const result = await loadMiningData({
          cachePath,
          miningCatalogCachePath,
          extractorPath: process.execPath,
          gameDataArchive: null
        })

        assert.equal(result.status.state, 'live')
        assert.equal(result.catalog, null)
        assert.equal(result.materials[0].id, 'agricium-ore')
      }
    )
  })
})

test('loadMiningData serves the cached material list when both the archive and the Wiki are unavailable', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-signatures.json')
    const miningCatalogCachePath = join(dir, 'mining-catalog.json')

    // Prime the material-list cache via a first successful Wiki call.
    await withFetchStub(
      () => ({ ok: true, status: 200, json: () => Promise.resolve(VALID_COMMODITY_LIST_RESPONSE) }),
      () =>
        loadMiningData({
          cachePath,
          miningCatalogCachePath,
          extractorPath: process.execPath,
          gameDataArchive: null
        })
    )

    await withFetchStub(
      () => ({ ok: false, status: 503, json: () => Promise.resolve({}) }),
      async () => {
        const result = await loadMiningData({
          cachePath,
          miningCatalogCachePath,
          extractorPath: process.execPath,
          gameDataArchive: null
        })

        assert.equal(result.status.state, 'cached')
        assert.equal(result.materials[0].id, 'agricium-ore')
      }
    )
  })
})

test('loadMiningData falls back to bundled materials when nothing else is available', async () => {
  await withTempDir(async (dir) => {
    const cachePath = join(dir, 'mining-signatures.json')
    const miningCatalogCachePath = join(dir, 'mining-catalog.json')

    await withFetchStub(
      () => ({ ok: false, status: 503, json: () => Promise.resolve({}) }),
      async () => {
        const result = await loadMiningData({
          cachePath,
          miningCatalogCachePath,
          extractorPath: process.execPath,
          gameDataArchive: null
        })

        assert.equal(result.status.state, 'fallback')
        assert.ok(result.materials.length > 0)
        assert.equal(result.catalog, null)
      }
    )
  })
})
