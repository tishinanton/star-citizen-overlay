import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { FactionReputation } from '../shared/contracts'
import { loadFactionData, parseGameFaction, parseGameFactionPayload } from './faction-data'

const GAME_VERSION = '4.9.187.47267-LIVE'

test('parses faction metadata and reputation requirements', () => {
  const extraction = parseGameFactionPayload(extractorPayload())
  const faction = extraction.factions[0]

  assert.equal(faction.name, 'Bounty Hunters Guild')
  assert.equal(faction.alignment, 'lawful')
  assert.equal(faction.scopeCount, 1)
  assert.equal(faction.standingCount, 2)
  assert.equal(faction.scopes[0].name, 'Bounty Hunting')
  assert.equal(faction.scopes[0].standings[1].name, 'Junior Bounty Hunter')
  assert.equal(faction.scopes[0].standings[1].minReputation, 3_000)
  assert.equal(faction.scopes[0].standings[0].gated, true)
})

test('rejects malformed and duplicate faction records', () => {
  assert.equal(parseGameFaction({}), null)

  const duplicate = extractorPayload()
  duplicate.factions[1] = duplicate.factions[0]
  assert.throws(() => parseGameFactionPayload(duplicate), /duplicate faction/)

  const invalidCount = extractorPayload()
  invalidCount.factions[0].standingCount = 5
  assert.throws(() => parseGameFactionPayload(invalidCount), /invalid faction record/)

  const invalidStanding = extractorPayload()
  invalidStanding.factions[0].scopes[0].standings[0].driftTimeHours = -1
  assert.throws(() => parseGameFactionPayload(invalidStanding), /invalid faction record/)
})

test('caches installed faction data by archive fingerprint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-game-factions-'))
  const archivePath = join(directory, 'Data.p4k')
  const cachePath = join(directory, 'factions.json')
  await writeFile(archivePath, 'archive')
  let extractionCount = 0
  const extract = async (): Promise<ReturnType<typeof parsedExtraction>> => {
    extractionCount += 1
    return parsedExtraction()
  }

  try {
    const live = await loadFactionData(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      extract
    )
    assert.equal(live.state, 'game')
    assert.equal(live.factions.length, 30)

    const current = await loadFactionData(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      async () => {
        throw new Error('matching cache should avoid extraction')
      }
    )
    assert.equal(current.state, 'game')
    assert.equal(extractionCount, 1)

    await rm(archivePath)
    const missingArchive = await loadFactionData({
      cachePath,
      extractorPath: 'extractor.exe',
      gameDataArchive: { path: archivePath, channel: 'LIVE' }
    })
    assert.equal(missingArchive.state, 'cached')
    assert.match(missingArchive.message, /archive unavailable/)

    const offline = await loadFactionData({
      cachePath,
      extractorPath: 'extractor.exe',
      gameDataArchive: null
    })
    assert.equal(offline.state, 'cached')
    assert.match(offline.message, /Game files/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('falls back to cached faction data when refreshed extraction fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-game-faction-fallback-'))
  const archivePath = join(directory, 'Data.p4k')
  const cachePath = join(directory, 'factions.json')
  await writeFile(archivePath, 'first')

  try {
    await loadFactionData(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      async () => parsedExtraction()
    )
    await writeFile(archivePath, 'changed archive')

    const cached = await loadFactionData(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      async () => {
        throw new Error('extractor failed')
      }
    )
    assert.equal(cached.state, 'cached')
    assert.match(cached.message, /extractor failed/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('requires game files or a cache for faction data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-game-faction-required-'))
  try {
    await assert.rejects(
      loadFactionData({
        cachePath: join(directory, 'missing.json'),
        extractorPath: 'extractor.exe',
        gameDataArchive: null
      }),
      /Choose Star Citizen Game files/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

function parsedExtraction(): ReturnType<typeof parseGameFactionPayload> {
  return parseGameFactionPayload(extractorPayload())
}

function extractorPayload(): {
  schemaVersion: number
  gameVersion: string
  factions: FactionReputation[]
  warnings: string[]
} {
  return {
    schemaVersion: 1,
    gameVersion: GAME_VERSION,
    factions: Array.from({ length: 30 }, (_, index) => faction(index)),
    warnings: []
  }
}

function faction(index: number): FactionReputation {
  return {
    id: `faction-${index}`,
    key: `FactionReputation_Lawful_Faction_${index}`,
    name: index === 0 ? 'Bounty Hunters Guild' : `Faction ${index}`,
    description: index === 0 ? 'Tracks licensed bounty work across the empire.' : null,
    alignment: index % 2 === 0 ? 'lawful' : 'unlawful',
    isNpc: false,
    hidden: false,
    headquarters: index === 0 ? 'Terra' : null,
    focus: index === 0 ? 'Bounty hunting' : null,
    scopeCount: 1,
    standingCount: 2,
    scopes: [
      {
        id: `scope-${index}`,
        name: 'Bounty Hunting',
        description: null,
        initialReputation: 0,
        reputationCeiling: 480_001,
        standings: [
          {
            id: `standing-${index}-applicant`,
            name: 'Applicant',
            minReputation: 0,
            driftReputation: 0,
            driftTimeHours: 0,
            gated: true,
            perkDescription: null
          },
          {
            id: `standing-${index}-junior`,
            name: 'Junior Bounty Hunter',
            minReputation: 3_000,
            driftReputation: 0,
            driftTimeHours: 0,
            gated: false,
            perkDescription: 'New missions'
          }
        ]
      }
    ]
  }
}
