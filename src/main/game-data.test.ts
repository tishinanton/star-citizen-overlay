import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { MiningMethod } from '../shared/contracts'
import {
  inferCanonicalRecord,
  mergeGameSignatures,
  loadGameDataPreference,
  normalizeCommodityKey,
  parseGameSignaturePayload,
  resolveGameDataArchive,
  saveGameDataPreference,
  type GameMaterialSignature,
  type MiningMaterialMetadata
} from './game-data'

function record(name: string, signature: number): Record<string, unknown> {
  return {
    recordPath: `libs/foundry/records/entities/mineable/${name}.xml`,
    entityName: `EntityClassDefinition.${name}`,
    compositionPath: null,
    globalParamsPath: null,
    signature
  }
}

function completeRecords(extra: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return [
    ...Array.from({ length: 20 }, (_, index) =>
      record(`mineablerock_asteroidcommon_ore${index}`, 4_000 + index)
    ),
    ...extra
  ]
}

test('parses canonical ship, FPS, and ground-vehicle records', () => {
  const signatures = parseGameSignaturePayload({
    schemaVersion: 1,
    records: completeRecords([
      record('mineablerock_surfacelegendary_quantainium', 3_170),
      record('mineablerock_asteroidlegendary_quantainium', 3_170),
      record('mineablerock_fps_carinite', 3_000),
      record('mineablerock_fps_carinite_large', 3_000),
      record('mineablerock_groundvehicle_carinite', 4_000),
      record('mineablerock_asteroidcommon_template', 9_999),
      record('cavelargemineablerock', 4_000)
    ])
  })

  assert.deepEqual(
    signatures.filter((entry) => entry.key === 'quantainium' || entry.key === 'carinite'),
    [
      { key: 'quantainium', signature: 3_170, methods: ['Ship'] },
      { key: 'carinite', signature: 4_000, methods: ['Ground Vehicle'] },
      { key: 'carinite', signature: 3_000, methods: ['FPS'] }
    ]
  )
})

// Regression test: verified against the installed LIVE Data.p4k, where
// MineableRock_FPS_Carinite_Pure_small's composition resolves to a genuinely distinct
// catalog material ("Carinite (Pure)") from the plain Carinite FPS/large/small variants.
// A "_pure" qualifier must therefore stay part of the canonical key rather than being folded
// into the large/small size-suffix bucket, or buildMaterialsFromCatalog's cross-material
// consistency guard incorrectly throws for a perfectly valid game archive.
test('keeps a "_pure" FPS qualifier as a distinct canonical key from its base material', () => {
  assert.deepEqual(
    inferCanonicalRecord('libs/foundry/records/entities/mineable/mineablerock_fps_carinite.xml'),
    { key: 'carinite', method: 'FPS' }
  )
  assert.deepEqual(
    inferCanonicalRecord(
      'libs/foundry/records/entities/mineable/mineablerock_fps_carinite_large.xml'
    ),
    { key: 'carinite', method: 'FPS' }
  )
  assert.deepEqual(
    inferCanonicalRecord(
      'libs/foundry/records/entities/mineable/mineablerock_fps_carinite_small.xml'
    ),
    { key: 'carinite', method: 'FPS' }
  )
  assert.deepEqual(
    inferCanonicalRecord(
      'libs/foundry/records/entities/mineable/mineablerock_fps_carinite_pure_small.xml'
    ),
    { key: 'carinite_pure', method: 'FPS' }
  )
})

test('does not collide a "_pure" FPS variant with its base material key in the signature payload', () => {
  const signatures = parseGameSignaturePayload({
    schemaVersion: 1,
    records: completeRecords([
      record('mineablerock_fps_carinite', 3_000),
      record('mineablerock_fps_carinite_large', 3_000),
      record('mineablerock_fps_carinite_pure_small', 3_000)
    ])
  })

  assert.deepEqual(
    signatures.filter((entry) => entry.key === 'carinite' || entry.key === 'carinite_pure'),
    [
      { key: 'carinite', signature: 3_000, methods: ['FPS'] },
      { key: 'carinite_pure', signature: 3_000, methods: ['FPS'] }
    ]
  )
})

test('persists a custom archive and resolves an installed game channel', async (context) => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'rockfall-game-data-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const archivePath = join(directory, 'LIVE', 'Data.p4k')
  const preferencePath = join(directory, 'game-data.json')
  await fs.mkdir(join(directory, 'LIVE'))
  await fs.writeFile(archivePath, '')

  await saveGameDataPreference(preferencePath, archivePath)
  assert.deepEqual(await loadGameDataPreference(preferencePath), {
    preferredPath: archivePath,
    warning: null
  })
  assert.deepEqual(await resolveGameDataArchive(null, [archivePath]), {
    path: archivePath,
    channel: 'LIVE'
  })
})

test('rejects conflicting signatures for one ore and mining method', () => {
  assert.throws(
    () =>
      parseGameSignaturePayload({
        schemaVersion: 1,
        records: completeRecords([
          record('mineablerock_fps_hadanite', 3_000),
          record('mineablerock_fps_hadanite_large', 3_100)
        ])
      }),
    /Conflicting FPS signatures/
  )
})

test('normalizes commodity slugs and display names to game keys', () => {
  assert.equal(normalizeCommodityKey('quantainium-raw'), 'quantainium')
  assert.equal(normalizeCommodityKey('Raw Ice (Organic)'), 'ice')
  assert.equal(normalizeCommodityKey('Hephaestanite (R)'), 'hephaestanite')
})

test('maps game signatures onto API metadata and separates method-specific values', () => {
  const methods = (values: MiningMethod[]): MiningMethod[] => values
  const signatures: GameMaterialSignature[] = [
    { key: 'agricium', signature: 3_885, methods: methods(['Ship']) },
    { key: 'carinite', signature: 3_000, methods: methods(['FPS']) },
    { key: 'carinite', signature: 4_000, methods: methods(['Ground Vehicle']) }
  ]
  const metadata: MiningMaterialMetadata[] = [
    {
      id: 'agricium-ore',
      name: 'Agricium (Ore)',
      displayName: 'Agricium (Ore)',
      sourceSignature: 4_000,
      methods: ['Ship'],
      sourceUrl: 'https://example.com/agricium'
    },
    {
      id: 'carinite',
      name: 'Carinite',
      displayName: 'Carinite',
      sourceSignature: 3_000,
      methods: [],
      sourceUrl: 'https://example.com/carinite'
    }
  ]

  assert.deepEqual(mergeGameSignatures(signatures, metadata), [
    {
      id: 'agricium-ore',
      commodityId: 'agricium-ore',
      name: 'Agricium (Ore)',
      displayName: 'Agricium (Ore)',
      signature: 3_885,
      methods: ['Ship'],
      catalogMaterialId: null,
      sourceUrl: 'https://example.com/agricium'
    },
    {
      id: 'carinite--ground-vehicle',
      commodityId: 'carinite',
      name: 'Carinite (Ground Vehicle)',
      displayName: 'Carinite (Ground Vehicle)',
      signature: 4_000,
      methods: ['Ground Vehicle'],
      catalogMaterialId: null,
      sourceUrl: 'https://example.com/carinite'
    },
    {
      id: 'carinite',
      commodityId: 'carinite',
      name: 'Carinite (FPS)',
      displayName: 'Carinite (FPS)',
      signature: 3_000,
      methods: ['FPS'],
      catalogMaterialId: null,
      sourceUrl: 'https://example.com/carinite'
    }
  ])
})
