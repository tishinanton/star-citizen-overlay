import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BlueprintDetail, FactionReputation, MiningMaterial } from '../../src/shared/contracts'
import {
  createStaticDataPublication,
  type StaticDataPublicationInput
} from '../../src/main/static-data-publication'

export const SYNTHETIC_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mMwTpv5HwAENAIyhHMY8AAAAABJRU5ErkJggg=='

export function createSyntheticStaticDataInput(): StaticDataPublicationInput {
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
    icons: { 'icons/test.tif': SYNTHETIC_PNG },
    factions: [faction('faction-b'), faction('faction-a')]
  }
}

export async function generateSyntheticStaticDataFixture(): Promise<void> {
  const publication = createStaticDataPublication(createSyntheticStaticDataInput())
  const fixtureDirectory = dirname(fileURLToPath(import.meta.url))
  await Promise.all([
    writeFile(resolve(fixtureDirectory, 'static-data-v1.synthetic.zip'), publication.archive),
    writeFile(
      resolve(fixtureDirectory, 'static-data-v1.synthetic.summary.json'),
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
  ])
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  generateSyntheticStaticDataFixture().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
