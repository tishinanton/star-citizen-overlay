import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  BlueprintDetail,
  FactionReputation,
  MiningMaterial
} from '../../src/shared/contracts'
import {
  createStaticDataPublication,
  type StaticDataPublication
} from '../../src/main/static-data-publication'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/p171jwAAAABJRU5ErkJggg=='

const materials: MiningMaterial[] = [
  {
    id: 'synthetic-ore',
    commodityId: 'synthetic-ore',
    name: 'Synthetic Ore',
    displayName: 'Synthetic Ore',
    signature: 4_000,
    methods: ['Ship', 'FPS'],
    sourceUrl: 'https://example.test/commodities/synthetic-ore'
  }
]

const factions: FactionReputation[] = [
  {
    id: 'synthetic-faction',
    key: 'SYNTHETIC_FACTION',
    name: 'Synthetic Faction',
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
        id: 'synthetic-scope',
        name: 'Synthetic Scope',
        description: null,
        initialReputation: 0,
        reputationCeiling: 10_000,
        standings: [
          {
            id: 'synthetic-standing',
            name: 'Synthetic Standing',
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
]

export function generateSyntheticStaticDataPublication(): StaticDataPublication {
  return createStaticDataPublication({
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
    materials,
    blueprints: [
      blueprint('synthetic-blueprint-null', null),
      blueprint('synthetic-blueprint-icon', 'icons/synthetic.tif')
    ],
    icons: { 'icons/synthetic.tif': PNG },
    factions
  })
}

export async function writeSyntheticStaticDataFixture(): Promise<void> {
  const publication = generateSyntheticStaticDataPublication()
  const outputDirectory = dirname(fileURLToPath(import.meta.url))
  await writeFile(join(outputDirectory, 'static-data-v1.synthetic.zip'), publication.archive)
  await writeFile(
    join(outputDirectory, 'static-data-v1.synthetic.summary.json'),
    `${JSON.stringify(
      {
        archiveBytes: publication.archive.byteLength,
        archiveSha256: publication.archiveSha256,
        manifestBytes: publication.manifestBytes,
        manifest: publication.manifest
      },
      null,
      2
    )}\n`
  )
}

function blueprint(id: string, imageKey: string | null): BlueprintDetail {
  return {
    id,
    key: id.toUpperCase(),
    outputName: id === 'synthetic-blueprint-icon' ? 'Synthetic Beacon' : 'Synthetic Relay',
    outputClass: 'SyntheticClass',
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void writeSyntheticStaticDataFixture().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
