import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { BlueprintDetail, LocalizationSource } from '../shared/contracts'
import {
  loadBlueprintData,
  parseGameBlueprint,
  parseGameBlueprintPayload,
  prepareBlueprintDataLoad
} from './blueprint-data'

const GAME_VERSION = '4.9.187.47267-LIVE'
const ICON_KEY = 'ui/textures/ea/loadouticons/heavy_armour_64.tif'
const ICON_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/p171jwAAAABJRU5ErkJggg=='

test('parses installed blueprint requirements, missions, and icons', () => {
  const extraction = parseGameBlueprintPayload(extractorPayload())
  const blueprint = extraction.details[0]

  assert.equal(blueprint.outputName, 'Field Recon Suit Arms')
  assert.equal(blueprint.isNew, false)
  assert.equal(blueprint.requirementGroups[0].ingredients[0].name, 'Iron')
  assert.equal(blueprint.requirementGroups[0].ingredients[0].quantityScu, 0.03)
  assert.equal(blueprint.unlockingMissions[0].title, 'Tactical Strike Group Needed')
  assert.equal(blueprint.unlockingMissions[0].provider, 'Foxwell Enforcement')
  assert.equal(blueprint.unlockingMissions[0].missionType, 'Mercenary')
  assert.equal(blueprint.unlockingMissions[0].minimumReputation, 'Senior Security Contractor')
  assert.equal(blueprint.unlockingMissions[0].reputationVaries, false)
  assert.deepEqual(blueprint.unlockingMissions[0].starSystems, ['Stanton'])
  assert.equal(blueprint.outputDescription, 'Heavy armor for field reconnaissance.')
  assert.equal(blueprint.outputManufacturer, 'Clark Defense Systems')
  assert.deepEqual(blueprint.outputStats, [
    { key: 'physical-protection', label: 'Physical protection', value: '40%' },
    { key: 'storage', label: 'Storage', value: '10,500 µSCU' }
  ])
  assert.equal(blueprint.imageKey, ICON_KEY)
  assert.equal(extraction.icons[ICON_KEY], ICON_DATA)
  assert.equal(
    blueprint.renderAsset?.path,
    'Objects/Characters/Human/male_v7/armor/field_recon_arms.skin'
  )
})

test('normalizes new blueprint markers while accepting older payloads', () => {
  const marked = blueprint(0)
  marked.isNew = true
  assert.equal(parseGameBlueprint(marked)?.isNew, true)

  const older = blueprint(1)
  delete older.isNew
  assert.equal(parseGameBlueprint(older)?.isNew, false)
})

test('rejects malformed and duplicate installed blueprint records', () => {
  assert.equal(parseGameBlueprint({}), null)

  const payload = extractorPayload()
  payload.blueprints[1] = payload.blueprints[0]
  assert.throws(() => parseGameBlueprintPayload(payload), /duplicate blueprint/)

  const malformed = extractorPayload()
  malformed.icons = { [ICON_KEY]: 'https://example.com/icon.png' }
  assert.throws(() => parseGameBlueprintPayload(malformed), /invalid blueprint icon/)

  const collidingIcons = extractorPayload()
  collidingIcons.icons = {
    [ICON_KEY]: ICON_DATA,
    [ICON_KEY.toUpperCase()]: ICON_DATA
  }
  assert.throws(
    () => parseGameBlueprintPayload(collidingIcons),
    /Blueprint icons contain colliding paths/
  )

  const invalidMission = extractorPayload()
  Object.assign(invalidMission.blueprints[0].unlockingMissions[0], {
    starSystems: ['Stanton', 'Stanton']
  })
  assert.throws(() => parseGameBlueprintPayload(invalidMission), /invalid blueprint record/)

  const duplicateStats = extractorPayload()
  duplicateStats.blueprints[0].outputStats.push(duplicateStats.blueprints[0].outputStats[0])
  assert.throws(() => parseGameBlueprintPayload(duplicateStats), /invalid blueprint record/)

  const invalidAsset = extractorPayload()
  invalidAsset.blueprints[0].renderAsset = {
    path: '../escaped.cgf',
    format: 'cgf'
  }
  assert.throws(() => parseGameBlueprintPayload(invalidAsset), /render asset is invalid/)
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

test('returns cached blueprints while a stale archive refreshes in the background', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-game-blueprint-revalidate-'))
  const archivePath = join(directory, 'Data.p4k')
  const cachePath = join(directory, 'blueprints.json')
  await writeFile(archivePath, 'archive')

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

    let releaseExtraction: () => void = () => undefined
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve
    })
    let markExtractionStarted: () => void = () => undefined
    const extractionStarted = new Promise<void>((resolve) => {
      markExtractionStarted = resolve
    })
    let refreshSettled = false
    const load = await prepareBlueprintDataLoad(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      async () => {
        markExtractionStarted()
        await extractionGate
        return parsedExtraction()
      }
    )
    void load.refreshed.then(
      () => {
        refreshSettled = true
      },
      () => {
        refreshSettled = true
      }
    )

    assert.equal(load.cached?.catalog.state, 'cached')
    assert.match(load.cached?.catalog.message ?? '', /checking for updates/i)
    await extractionStarted
    assert.equal(refreshSettled, false)

    releaseExtraction()
    const refreshed = await load.refreshed
    assert.equal(refreshed.catalog.state, 'game')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('returns a legacy cache while its schema migrates in the background', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-game-blueprint-migration-'))
  const archivePath = join(directory, 'Data.p4k')
  const cachePath = join(directory, 'blueprints.json')
  await writeFile(archivePath, 'archive')

  try {
    await loadBlueprintData(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      async () => parsedExtraction()
    )
    const legacyCache = JSON.parse(await readFile(cachePath, 'utf8')) as {
      schemaVersion: number
      details: Array<Record<string, unknown>>
    }
    legacyCache.schemaVersion = 4
    for (const detail of legacyCache.details) {
      delete detail.outputDescription
      delete detail.outputManufacturer
      delete detail.outputStats
    }
    await writeFile(cachePath, JSON.stringify(legacyCache))

    let releaseExtraction: () => void = () => undefined
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve
    })
    let markExtractionStarted: () => void = () => undefined
    const extractionStarted = new Promise<void>((resolve) => {
      markExtractionStarted = resolve
    })
    const load = await prepareBlueprintDataLoad(
      {
        cachePath,
        extractorPath: 'extractor.exe',
        gameDataArchive: { path: archivePath, channel: 'LIVE' }
      },
      async () => {
        markExtractionStarted()
        await extractionGate
        return parsedExtraction()
      }
    )

    assert.equal(load.cached?.catalog.state, 'cached')
    const cachedDetail = load.cached?.details[load.cached.catalog.blueprints[0].id]
    assert.equal(cachedDetail?.outputDescription, null)
    assert.deepEqual(cachedDetail?.outputStats, [])
    await extractionStarted

    releaseExtraction()
    const refreshed = await load.refreshed
    assert.equal(refreshed.catalog.state, 'game')
    assert.equal(
      refreshed.details[refreshed.catalog.blueprints[0].id].outputDescription,
      'Heavy armor for field reconnaissance.'
    )
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

test('re-extracts blueprints when localization switches to global.ini', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-localization-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const archivePath = join(directory, 'Data.p4k')
  const cachePath = join(directory, 'blueprints.json')
  const globalIniPath = join(directory, 'Data', 'Localization', 'english', 'global.ini')
  await writeFile(archivePath, 'archive')
  await mkdir(join(directory, 'Data', 'Localization', 'english'), { recursive: true })
  await writeFile(globalIniPath, 'blueprint_name=Localized blueprint\n')
  const sources: string[] = []

  const extract = async (
    _extractorPath: string,
    _archivePath: string,
    localizationSource: LocalizationSource = 'game'
  ): Promise<ReturnType<typeof parsedExtraction>> => {
    sources.push(localizationSource)
    return parsedExtraction()
  }

  await loadBlueprintData(
    {
      cachePath,
      extractorPath: 'extractor.exe',
      gameDataArchive: { path: archivePath, channel: 'LIVE' }
    },
    extract
  )
  await loadBlueprintData(
    {
      cachePath,
      extractorPath: 'extractor.exe',
      gameDataArchive: { path: archivePath, channel: 'LIVE' },
      localizationSource: 'global-ini'
    },
    extract
  )

  assert.deepEqual(sources, ['game', 'global-ini'])
})

test('does not use packaged-localization cache when global.ini is unavailable', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-blueprint-missing-localization-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const archivePath = join(directory, 'Data.p4k')
  const cachePath = join(directory, 'blueprints.json')
  await writeFile(archivePath, 'archive')

  await loadBlueprintData(
    {
      cachePath,
      extractorPath: 'extractor.exe',
      gameDataArchive: { path: archivePath, channel: 'LIVE' }
    },
    async () => parsedExtraction()
  )

  await assert.rejects(
    loadBlueprintData({
      cachePath,
      extractorPath: 'extractor.exe',
      gameDataArchive: { path: archivePath, channel: 'LIVE' },
      localizationSource: 'global-ini'
    }),
    /no local cache exists/i
  )
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
    schemaVersion: 10,
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
    outputDescription: 'Heavy armor for field reconnaissance.',
    outputManufacturer: 'Clark Defense Systems',
    outputStats: [
      { key: 'physical-protection', label: 'Physical protection', value: '40%' },
      { key: 'storage', label: 'Storage', value: '10,500 µSCU' }
    ],
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
    renderAsset:
      index === 0
        ? {
            path: 'Objects/Characters/Human/male_v7/armor/field_recon_arms.skin',
            format: 'skin'
          }
        : null,
    webUrl: null
  }
}
