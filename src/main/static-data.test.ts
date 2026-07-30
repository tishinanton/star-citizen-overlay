import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { readPublicationSource } from './static-data'

test('reads publication metadata without exposing the local archive path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-static-source-'))
  const archivePath = join(directory, 'Data.p4k')
  await writeFile(archivePath, 'synthetic archive')
  await writeFile(
    join(directory, 'build_manifest.id'),
    JSON.stringify({ Data: { Branch: 'synthetic-branch', Version: '0.0.1' } })
  )
  try {
    const source = await readPublicationSource({ path: archivePath, channel: 'TEST' }, '0.2.0')
    assert.deepEqual(source, {
      gameBuild: '0.0.1-TEST',
      gameVersion: 'synthetic-branch',
      channel: 'TEST',
      archiveBytes: 17,
      archiveModifiedAt: source.archiveModifiedAt,
      desktopVersion: '0.2.0'
    })
    assert.equal(JSON.stringify(source).includes(archivePath), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('requires a valid build manifest for publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-static-manifest-'))
  const archivePath = join(directory, 'Data.p4k')
  await writeFile(archivePath, 'synthetic archive')
  try {
    await assert.rejects(
      readPublicationSource({ path: archivePath, channel: 'TEST' }, '0.2.0'),
      /build manifest could not be read/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
