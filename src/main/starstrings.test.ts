import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  ensureEnglishLanguageConfig,
  inspectStarStringsInstallation,
  installExtractedStarStrings,
  parseLatestStarStringsRelease,
  resolveLiveGamePath
} from './starstrings'

const RELEASE = {
  version: '357839513:485657974:2026-07-22T07:31:01Z',
  name: 'SC LIVE Build (release-2026-07-22-efdf111)',
  publishedAt: '2026-07-22T07:31:01Z'
}

test('parses and validates the LIVE release asset', () => {
  assert.deepEqual(
    parseLatestStarStringsRelease({
      id: 357839513,
      name: RELEASE.name,
      published_at: RELEASE.publishedAt,
      assets: [
        {
          id: 485657974,
          name: 'StarStrings-LIVE.zip',
          size: 2_372_530,
          digest: 'sha256:a5041cdb8d4617db67ed39c75add28721de4fbb80b029737d092feb646194186',
          updated_at: '2026-07-22T07:31:01Z',
          browser_download_url:
            'https://github.com/MrKraken/StarStrings/releases/download/latest/StarStrings-LIVE.zip'
        }
      ]
    }),
    {
      ...RELEASE,
      assetSize: 2_372_530,
      digest: 'sha256:a5041cdb8d4617db67ed39c75add28721de4fbb80b029737d092feb646194186',
      downloadUrl:
        'https://github.com/MrKraken/StarStrings/releases/download/latest/StarStrings-LIVE.zip'
    }
  )
})

test('rejects a release asset hosted outside the StarStrings repository', () => {
  assert.throws(
    () =>
      parseLatestStarStringsRelease({
        id: 1,
        name: 'Release',
        published_at: '2026-07-22T07:31:01Z',
        assets: [
          {
            id: 2,
            name: 'StarStrings-LIVE.zip',
            size: 100,
            digest: null,
            updated_at: '2026-07-22T07:31:01Z',
            browser_download_url: 'https://example.com/StarStrings-LIVE.zip'
          }
        ]
      }),
    /must come from its GitHub repository/
  )
})

test('preserves user config settings while enabling English localization', () => {
  assert.equal(
    ensureEnglishLanguageConfig('r_width = 2560\r\nr_height = 1440\r\n'),
    'r_width = 2560\r\nr_height = 1440\r\ng_language = english\r\n'
  )
  assert.equal(
    ensureEnglishLanguageConfig('r_width = 2560\ng_language = german\n'),
    'r_width = 2560\ng_language = english\n'
  )
})

test('finds LIVE beside a selected PTU install', async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'rockfall-starstrings-detect-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const ptuArchive = join(root, 'PTU', 'Data.p4k')
  const liveArchive = join(root, 'LIVE', 'Data.p4k')
  await fs.mkdir(join(root, 'PTU'))
  await fs.mkdir(join(root, 'LIVE'))
  await fs.writeFile(ptuArchive, '')
  await fs.writeFile(liveArchive, '')

  assert.equal(
    await resolveLiveGamePath({ path: ptuArchive, channel: 'PTU' }, []),
    join(root, 'LIVE')
  )
})

test('installs localization, preserves USER.cfg, and records the release', async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'rockfall-starstrings-install-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const livePath = join(root, 'LIVE')
  const extractedPath = join(root, 'extracted')
  const recordPath = join(root, 'state', 'starstrings.json')
  await fs.mkdir(join(extractedPath, 'Data', 'Localization', 'english'), { recursive: true })
  await fs.mkdir(livePath)
  await fs.writeFile(join(livePath, 'Data.p4k'), '')
  await fs.writeFile(join(livePath, 'USER.cfg'), 'r_width = 3440\r\n')
  await fs.writeFile(
    join(extractedPath, 'Data', 'Localization', 'english', 'global.ini'),
    'mission_title=[BP] Test contract\n'
  )

  const installation = await installExtractedStarStrings({
    extractedPath,
    livePath,
    recordPath,
    release: RELEASE,
    installedAt: '2026-07-31T11:30:00Z'
  })

  assert.deepEqual(installation, {
    ...RELEASE,
    installedAt: '2026-07-31T11:30:00Z'
  })
  assert.equal(
    await fs.readFile(join(livePath, 'Data', 'Localization', 'english', 'global.ini'), 'utf8'),
    'mission_title=[BP] Test contract\n'
  )
  assert.equal(
    await fs.readFile(join(livePath, 'USER.cfg'), 'utf8'),
    'r_width = 3440\r\ng_language = english\r\n'
  )
  assert.deepEqual(await inspectStarStringsInstallation(recordPath, livePath), {
    installedRelease: installation,
    localizationPresent: true,
    warning: null
  })

  await fs.appendFile(
    join(livePath, 'Data', 'Localization', 'english', 'global.ini'),
    'modified=true\n'
  )
  assert.deepEqual(await inspectStarStringsInstallation(recordPath, livePath), {
    installedRelease: null,
    localizationPresent: true,
    warning: 'The installed localization file changed after Rockfall last synced it.'
  })
})

test('rolls back game files when the install transaction cannot finish', async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'rockfall-starstrings-rollback-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const livePath = join(root, 'LIVE')
  const extractedPath = join(root, 'extracted')
  const recordPath = join(root, 'state', 'starstrings.json')
  const globalIniPath = join(livePath, 'Data', 'Localization', 'english', 'global.ini')
  await fs.mkdir(join(extractedPath, 'Data', 'Localization', 'english'), { recursive: true })
  await fs.mkdir(join(livePath, 'Data', 'Localization', 'english'), { recursive: true })
  await fs.mkdir(recordPath, { recursive: true })
  await fs.writeFile(join(livePath, 'Data.p4k'), '')
  await fs.writeFile(join(livePath, 'USER.cfg'), 'r_width = 3440\r\n')
  await fs.writeFile(globalIniPath, 'original=true\n')
  await fs.writeFile(
    join(extractedPath, 'Data', 'Localization', 'english', 'global.ini'),
    'replacement=true\n'
  )

  await assert.rejects(
    installExtractedStarStrings({
      extractedPath,
      livePath,
      recordPath,
      release: RELEASE,
      installedAt: '2026-07-31T11:30:00Z'
    })
  )
  assert.equal(await fs.readFile(globalIniPath, 'utf8'), 'original=true\n')
  assert.equal(await fs.readFile(join(livePath, 'USER.cfg'), 'utf8'), 'r_width = 3440\r\n')
})
