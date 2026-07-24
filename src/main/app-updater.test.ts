import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { AppUpdaterController, type UpdaterClient } from './app-updater'

function createFakeUpdater(): {
  updater: UpdaterClient
  emitter: EventEmitter
  getCheckCount: () => number
  getInstallArgs: () => [boolean | undefined, boolean | undefined] | null
  failChecksWith: (error: Error | null) => void
} {
  const emitter = new EventEmitter()
  let checkCount = 0
  let checkError: Error | null = null
  let installArgs: [boolean | undefined, boolean | undefined] | null = null

  const updater: UpdaterClient = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    async checkForUpdates() {
      checkCount += 1
      if (checkError) throw checkError
    },
    quitAndInstall(isSilent, isForceRunAfter) {
      installArgs = [isSilent, isForceRunAfter]
    },
    onError: (listener) => {
      emitter.on('error', listener)
    },
    onCheckingForUpdate: (listener) => {
      emitter.on('checking-for-update', listener)
    },
    onUpdateAvailable: (listener) => {
      emitter.on('update-available', listener)
    },
    onUpdateNotAvailable: (listener) => {
      emitter.on('update-not-available', listener)
    },
    onDownloadProgress: (listener) => {
      emitter.on('download-progress', listener)
    },
    onUpdateDownloaded: (listener) => {
      emitter.on('update-downloaded', listener)
    }
  }

  return {
    updater,
    emitter,
    getCheckCount: () => checkCount,
    getInstallArgs: () => installArgs,
    failChecksWith: (error) => {
      checkError = error
    }
  }
}

test('reports that updates are unavailable in development builds', async () => {
  const fake = createFakeUpdater()
  const controller = new AppUpdaterController(fake.updater, {
    enabled: false,
    currentVersion: '0.1.1',
    onStateChange: () => undefined
  })

  controller.start()
  const state = await controller.checkForUpdates()

  assert.equal(state.status, 'unavailable')
  assert.equal(state.currentVersion, '0.1.1')
  assert.equal(fake.getCheckCount(), 0)
  assert.equal(fake.updater.autoDownload, false)
})

test('downloads an available update and restarts into the installer', async () => {
  const fake = createFakeUpdater()
  const controller = new AppUpdaterController(fake.updater, {
    enabled: true,
    currentVersion: '0.1.1',
    onStateChange: () => undefined
  })

  controller.start()
  await controller.checkForUpdates()
  assert.equal(fake.updater.autoDownload, true)
  assert.equal(fake.updater.autoInstallOnAppQuit, true)

  fake.emitter.emit('update-available', { version: '0.2.0' })
  assert.deepEqual(controller.getState(), {
    status: 'downloading',
    currentVersion: '0.1.1',
    availableVersion: '0.2.0',
    downloadProgress: 0,
    message: 'Downloading Rockfall v0.2.0…'
  })

  fake.emitter.emit('download-progress', { percent: 42.6 })
  assert.equal(controller.getState().downloadProgress, 43)
  fake.emitter.emit('download-progress', { percent: Number.NaN })
  assert.equal(controller.getState().downloadProgress, 0)

  fake.emitter.emit('update-downloaded', { version: '0.2.0' })
  assert.equal(controller.getState().status, 'ready')

  controller.restartToUpdate()
  assert.deepEqual(fake.getInstallArgs(), [false, true])
  controller.stop()
})

test('coalesces concurrent checks and exposes updater failures', async () => {
  const fake = createFakeUpdater()
  fake.failChecksWith(new Error('release server unavailable'))
  const controller = new AppUpdaterController(fake.updater, {
    enabled: true,
    currentVersion: '0.1.1',
    onStateChange: () => undefined
  })

  const firstCheck = controller.checkForUpdates()
  const secondCheck = controller.checkForUpdates()
  const [firstState, secondState] = await Promise.all([firstCheck, secondCheck])

  assert.equal(fake.getCheckCount(), 1)
  assert.equal(firstState.status, 'error')
  assert.deepEqual(secondState, firstState)
  assert.match(firstState.message, /release server unavailable/)
})

test('rejects restart before an update has downloaded', () => {
  const fake = createFakeUpdater()
  const controller = new AppUpdaterController(fake.updater, {
    enabled: true,
    currentVersion: '0.1.1',
    onStateChange: () => undefined
  })

  assert.throws(() => controller.restartToUpdate(), /No downloaded update/)
})
