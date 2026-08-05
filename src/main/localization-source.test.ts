import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  getLooseLocalizationPath,
  loadLocalizationSource,
  saveLocalizationSource,
  validateLocalizationSource
} from './localization-source'

test('defaults to packaged game localization and persists an explicit global.ini choice', async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'rockfall-localization-source-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const preferencePath = join(root, 'state', 'localization.json')

  assert.deepEqual(await loadLocalizationSource(preferencePath), {
    source: 'game',
    warning: null
  })

  await saveLocalizationSource(preferencePath, 'global-ini')
  assert.deepEqual(await loadLocalizationSource(preferencePath), {
    source: 'global-ini',
    warning: null
  })
})

test('requires the loose global.ini before selecting it', async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'rockfall-localization-validation-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const archive = { path: join(root, 'LIVE', 'Data.p4k'), channel: 'LIVE' }
  await fs.mkdir(join(root, 'LIVE'), { recursive: true })
  await fs.writeFile(archive.path, '')

  await assert.rejects(validateLocalizationSource('global-ini', archive), /global\.ini/)

  const localizationPath = getLooseLocalizationPath(archive.path)
  await fs.mkdir(dirname(localizationPath), { recursive: true })
  await fs.writeFile(localizationPath, 'key=value\n')
  await validateLocalizationSource('global-ini', archive)
})
