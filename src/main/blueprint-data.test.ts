import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { BlueprintDetail } from '../shared/contracts'
import { loadBlueprintData, parseGameBlueprint, parseGameBlueprintPayload } from './blueprint-data'

const GAME_VERSION = '4.9.187.47267-LIVE'
const ICON_KEY = 'ui/textures/ea/loadouticons/heavy_armour_64.tif'
const ICON_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/p171jwAAAABJRU5ErkJggg=='

test('parses installed blueprint requirements, missions, and icons', () => {
  const extraction = parseGameBlueprintPayload(extractorPayload())
  const blueprint = extraction.details[0]

  assert.equal(blueprint.outputName, 'Field Recon Suit Arms')
  assert.equal(blueprint.requirementGroups[0].ingredients[0].name, 'Iron')
  assert.equal(blueprint.requirementGroups[0].ingredients[0].quantityScu, 0.03)
  assert.equal(blueprint.unlockingMissions[0].title, 'Tactical Strike Group Needed')
  assert.equal(blueprint.unlockingMissions[0].provider, 'Foxwell Enforcement')
  assert.equal(blueprint.unlockingMissions[0].missionType, 'Mercenary')
  assert.equal(blueprint.unlockingMissions[0].minimumReputation, 'Senior Security Contractor')
  assert.equal(blueprint.unlockingMissions[0].reputationVaries, false)
  assert.deepEqual(blueprint.unlockingMissions[0].starSystems, ['Stanton'])
  assert.equal(blueprint.imageKey, ICON_KEY)
  assert.equal(extraction.icons[ICON_KEY], ICON_DATA)
})

test('rejects malformed and duplicate installed blueprint records', () => {
  assert.equal(parseGameBlueprint({}), null)

  const payload = extractorPayload()
  payload.blueprints[1] = payload.blueprints[0]
  assert.throws(() => parseGameBlueprintPayload(payload), /duplicate blueprint/)

  const malformed = extractorPayload()
  malformed.icons = { [ICON_KEY]: 'https://example.com/icon.png' }
  assert.throws(() => parseGameBlueprintPayload(malformed), /invalid blueprint icon/)

  const invalidMission = extractorPayload()
  Object.assign(invalidMission.blueprints[0].unlockingMissions[0], {
    starSystems: ['Stanton', 'Stanton']
  })
  assert.throws(() => parseGameBlueprintPayload(invalidMission), /invalid blueprint record/)
})

test('caches installed blueprints by archive fingerprint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-game-blueprints-'))
  const archivePath = join(directory, 'Data.p4k')
  const cachePath = join(directory, 'blueprints.json')
  await writeFile(archivePath, 'archive')
  let extractionCount = 0
  const extract = async (): Promise<ReturnType<typeof parsedExtraction>> => {
    extractionCount += 1
    return parsedExtraction()
  }

  try {
    const live = await loadBlueprintData(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      extract
    )
    assert.equal(live.catalog.state, 'game')
    assert.equal(live.catalog.blueprints.length, 1_500)
    assert.equal(live.details[live.catalog.blueprints[0].id].outputName, 'Field Recon Suit Arms')

    const current = await loadBlueprintData(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      async () => {
        throw new Error('matching cache should avoid extraction')
      }
    )
    assert.equal(current.catalog.state, 'game')
    assert.equal(extractionCount, 1)

    await rm(archivePath)
    const missingArchive = await loadBlueprintData({
      cachePath,
      extractorPath: 'extractor.exe',
      gameDataArchive: { path: archivePath, channel: 'LIVE' }
    })
    assert.equal(missingArchive.catalog.state, 'cached')
    assert.match(missingArchive.catalog.message, /archive unavailable/)

    const offline = await loadBlueprintData({
      cachePath,
      extractorPath: 'extractor.exe',
      gameDataArchive: null
    })
    assert.equal(offline.catalog.state, 'cached')
    assert.match(offline.catalog.message, /Game files/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('falls back to cached game data when refreshed extraction fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-game-blueprint-fallback-'))
  const archivePath = join(directory, 'Data.p4k')
  const cachePath = join(directory, 'blueprints.json')
  await writeFile(archivePath, 'first')

  try {
    await loadBlueprintData(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      async () => parsedExtraction()
    )
    await writeFile(archivePath, 'changed archive')

    const cached = await loadBlueprintData(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      async () => {
        throw new Error('extractor failed')
      }
    )
    assert.equal(cached.catalog.state, 'cached')
    assert.match(cached.catalog.message, /extractor failed/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('keeps extracted data available when its cache cannot be written', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-game-blueprint-cache-error-'))
  const archivePath = join(directory, 'Data.p4k')
  const blockedDirectory = join(directory, 'not-a-directory')
  await writeFile(archivePath, 'archive')
  await writeFile(blockedDirectory, 'blocked')

  try {
    const result = await loadBlueprintData(
      {
        cachePath: join(blockedDirectory, 'blueprints.json'),
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      async () => parsedExtraction()
    )
    assert.equal(result.catalog.state, 'game')
    assert.match(result.catalog.message, /Cache unavailable/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('requires game files or a cache for blueprint data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-game-blueprint-required-'))
  try {
    await assert.rejects(
      loadBlueprintData({
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

function parsedExtraction(): ReturnType<typeof parseGameBlueprintPayload> {
  return parseGameBlueprintPayload(extractorPayload())
}

function extractorPayload(): {
  schemaVersion: number
  gameVersion: string
  blueprints: BlueprintDetail[]
  icons: Record<string, string>
  warnings: string[]
} {
  return {
    schemaVersion: 3,
    gameVersion: GAME_VERSION,
    blueprints: Array.from({ length: 1_500 }, (_, index) => blueprint(index)),
    icons: { [ICON_KEY]: ICON_DATA },
    warnings: []
  }
}

function blueprint(index: number): BlueprintDetail {
  const id = `blueprint-${index}`
  return {
    id,
    key: `BP_CRAFT_${index}`,
    outputName: index === 0 ? 'Field Recon Suit Arms' : `Blueprint ${index}`,
    outputClass: `item_${index}`,
    outputType: 'Char_Armor_Arms',
    outputTypeLabel: 'Arms (Armor)',
    outputGrade: '1',
    craftTimeSeconds: 120,
    craftTimeLabel: '2 minutes',
    availableByDefault: index < 8,
    ingredientCount: 1,
    unlockingMissionCount: 1,
    ingredients: [
      {
        name: 'Iron',
        kind: 'resource',
        quantity: null,
        quantityScu: 0.03,
        webUrl: null
      }
    ],
    requirementGroups: [
      {
        key: 'FRAME',
        name: 'Frame',
        requiredCount: 1,
        ingredients: [
          {
            name: 'Iron',
            kind: 'resource',
            quantity: null,
            quantityScu: 0.03,
            webUrl: null,
            minQuality: 1
          }
        ]
      }
    ],
    unlockingMissions: [
      {
        id: `mission-${index}`,
        title: 'Tactical Strike Group Needed',
        missionType: 'Mercenary',
        contractType: 'Eliminate All',
        provider: 'Foxwell Enforcement',
        minimumReputation: 'Senior Security Contractor',
        reputationVaries: false,
        starSystems: ['Stanton'],
        chance: 1,
        webUrl: null
      }
    ],
    gameVersion: GAME_VERSION,
    imageKey: index === 0 ? ICON_KEY : null,
    webUrl: null
  }
}
