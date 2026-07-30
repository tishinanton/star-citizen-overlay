import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type {
  CloudOwnershipSnapshot,
  CloudStaticDataCapabilities,
  CloudStaticDataCurrentRelease,
  CloudStaticDataPublishResult,
  CloudSyncOperation,
  CloudSyncResponse,
  CloudTokenPair
} from './cloud-api'
import { CloudApiError, CloudNetworkError } from './cloud-api'
import type { OwnershipSyncProfile } from './blueprint-ownership'
import { createCloudState, loadCloudState, saveCloudState } from './cloud-state'
import {
  CloudSyncController,
  parseCloudLoginUrl,
  selectSyncOperations,
  type RefreshTokenProtector
} from './cloud-sync'

const USER_ID = '8d301e3e-6fd2-4900-a671-b20d48ab8403'
const OTHER_USER_ID = '71c34e0d-ca0b-4a68-aa40-0846d7f2e784'
const LOGIN_ID = 'b43fe4e9-9f00-49f7-8290-46a59bd8c2e2'
const NOW = '2026-07-27T16:55:00.000Z'
const LATER = '2026-08-26T16:55:00.000Z'

test('completes split-secret login, imports local ownership, and restores the session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-cloud-sync-'))
  const storePath = join(directory, 'cloud-state.json')
  const api = new FakeCloudApi()
  const openedUrls: string[] = []
  const states: string[] = []
  const localProfiles = [localProfile()]
  let localProfilesPrepared = false
  const options = {
    storePath,
    apiUrl: 'http://127.0.0.1:5050',
    appVersion: '0.1.11',
    deviceName: 'Gaming PC',
    tokenProtector: protector(),
    getLocalProfiles: () => {
      assert.equal(localProfilesPrepared, true)
      return localProfiles
    },
    prepareLocalProfiles: async () => {
      localProfilesPrepared = true
    },
    getActiveProfile: () => ({
      channel: 'LIVE',
      accountId: '123456789',
      handle: 'CurrentPilot'
    }),
    openExternal: async (url: string) => {
      openedUrls.push(url)
    },
    onStateChange: (state: { status: string }) => states.push(state.status),
    onOwnershipChange: () => undefined,
    apiFactory: () => api,
    now: () => new Date(NOW),
    sleep: async () => undefined,
    syncIntervalMs: 60 * 60 * 1_000
  }
  const first = new CloudSyncController(options)

  try {
    await first.initialize()
    const waiting = await first.beginLogin()
    assert.equal(waiting.status, 'waiting-for-browser')
    assert.equal(openedUrls.length, 1)
    assert.deepEqual(api.createdLoginRequest, {
      installationId: api.createdLoginRequest?.installationId,
      deviceName: 'Gaming PC',
      appVersion: '0.1.11'
    })

    const synced = await first.completeLoginCode('handoff-code')
    assert.equal(synced.status, 'synced', synced.message)
    assert.equal(synced.user?.displayName, 'Nelly')
    assert.equal(synced.pendingOperationCount, 0)
    assert.equal(api.exchanged?.requestSecret, 'request-secret')
    assert.equal(api.syncedOperations.length, 2)
    const publication = await first.publishStaticDataRelease(Buffer.from('archive'))
    assert.equal(publication.status, 'published')
    api.role = 'user'
    api.publicationError = new CloudApiError('Administrator access changed.', {
      status: 403,
      code: 'static_data_admin_required'
    })
    await assert.rejects(first.publishStaticDataRelease(Buffer.from('archive')))
    assert.equal(first.getSnapshot().user?.role, 'user')
    api.role = 'admin'
    api.publicationError = null
    assert.equal(
      first.getOwnershipLayer()?.receipts.some((receipt) => receipt.name === 'QuadraCell'),
      true
    )
    assert.equal(first.getOwnershipLayer()?.manualBlueprints[0].owned, true)

    await first.recordManualChange(
      { channel: 'LIVE', accountId: '123456789', handle: 'CurrentPilot' },
      {
        blueprintId: 'duplicate-a',
        blueprintKey: 'duplicate-key-a',
        owned: false,
        changedAt: NOW
      }
    )
    assert.equal(first.getOwnershipLayer()?.manualBlueprints[0].owned, false)
    const persisted = await readFile(storePath, 'utf8')
    assert.equal(persisted.includes('refresh-token'), false)
    first.dispose()

    const restored = new CloudSyncController(options)
    await restored.initialize()
    await restored.syncNow()
    assert.ok(api.refreshCount > 0)
    assert.equal(restored.getSnapshot().status, 'synced')
    assert.equal(restored.getOwnershipLayer()?.manualBlueprints[0].owned, false)
    restored.dispose()
    assert.ok(states.includes('restoring'))
    assert.ok(states.includes('synced'))
  } finally {
    first.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('parses only bound Rockfall Discord callback URLs', () => {
  assert.deepEqual(
    parseCloudLoginUrl(
      `rockfall://auth/discord?loginRequestId=${LOGIN_ID}&handoffCode=handoff-code`
    ),
    { loginRequestId: LOGIN_ID, handoffCode: 'handoff-code' }
  )
  assert.throws(() => parseCloudLoginUrl('https://example.com/callback'), /not a Rockfall/)
  assert.throws(() => parseCloudLoginUrl('rockfall://auth/discord'), /missing/)
})

test('keeps sync batches within both operation-count and request-size limits', () => {
  const operations: CloudSyncOperation[] = Array.from({ length: 500 }, (_, index) => ({
    operationId: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    kind: 'receipt.upsert',
    profile: {
      channel: 'LIVE',
      accountId: String(index),
      handle: '😀'.repeat(200)
    },
    receipt: {
      name: '😀'.repeat(500),
      firstSeenAt: NOW,
      lastSeenAt: NOW
    }
  }))

  const selected = selectSyncOperations('4219', operations)
  assert.ok(selected.length > 0)
  assert.ok(selected.length < 500)
  assert.ok(
    Buffer.byteLength(JSON.stringify({ cursor: '4219', operations: selected }), 'utf8') <=
      1024 * 1024
  )
})

test('does not replay a refresh token after an ambiguous network failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-cloud-refresh-'))
  const storePath = join(directory, 'cloud-state.json')
  const api = new FakeCloudApi()
  const options = {
    storePath,
    apiUrl: 'http://127.0.0.1:5050',
    appVersion: '0.1.11',
    deviceName: 'Gaming PC',
    tokenProtector: protector(),
    getLocalProfiles: () => [localProfile()],
    getActiveProfile: () => ({
      channel: 'LIVE',
      accountId: '123456789',
      handle: 'CurrentPilot'
    }),
    openExternal: () => Promise.resolve(),
    onStateChange: () => undefined,
    onOwnershipChange: () => undefined,
    apiFactory: () => api,
    now: () => new Date(NOW),
    sleep: () => Promise.resolve(),
    syncIntervalMs: 60 * 60 * 1_000
  }
  const first = new CloudSyncController(options)

  try {
    await first.initialize()
    await first.beginLogin()
    await first.completeLoginCode('handoff-code')
    first.dispose()

    api.refreshError = new CloudNetworkError('The response was interrupted.', 'ECONNRESET')
    api.refreshCount = 0
    const restored = new CloudSyncController(options)
    await restored.initialize()
    await waitFor(() => restored.getSnapshot().status === 'auth-expired')
    assert.equal(api.refreshCount, 1)
    assert.equal(restored.getSnapshot().user, null)
    restored.dispose()
  } finally {
    first.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('routes an edit with unknown local identity to the sole visible cloud profile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-cloud-fallback-profile-'))
  const storePath = join(directory, 'cloud-state.json')
  const api = new FakeCloudApi()
  api.snapshotProfiles = [
    {
      profileId: '22280eef-dce1-48ca-964f-8f11ddaf5e65',
      channel: 'LIVE',
      accountId: '123456789',
      handle: 'CurrentPilot',
      receipts: [],
      manualBlueprints: []
    }
  ]
  const controller = new CloudSyncController({
    storePath,
    apiUrl: 'http://127.0.0.1:5050',
    appVersion: '0.1.11',
    deviceName: 'Gaming PC',
    tokenProtector: protector(),
    getLocalProfiles: () => [],
    getActiveProfile: () => ({ channel: 'LIVE', accountId: null, handle: null }),
    openExternal: () => Promise.resolve(),
    onStateChange: () => undefined,
    onOwnershipChange: () => undefined,
    apiFactory: () => api,
    now: () => new Date(NOW),
    sleep: () => Promise.resolve(),
    syncIntervalMs: 60 * 60 * 1_000
  })

  try {
    await controller.initialize()
    await controller.beginLogin()
    await controller.completeLoginCode('handoff-code')
    await controller.recordManualChange(
      { channel: 'LIVE', accountId: 'manual', handle: null },
      {
        blueprintId: 'duplicate-a',
        blueprintKey: 'duplicate-key-a',
        owned: false,
        changedAt: NOW,
        keyIsUnique: true
      }
    )
    assert.equal(controller.getSnapshot().pendingOperationCount, 1)
    await controller.syncNow()
    assert.equal(api.syncedOperations.at(-1)?.profile.accountId, '123456789')
  } finally {
    controller.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('keeps cross-user import confirmation active across every capture chunk', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-cloud-confirm-chunks-'))
  const storePath = join(directory, 'cloud-state.json')
  const state = createCloudState()
  state.lastUserId = OTHER_USER_ID
  state.profileAssociations['LIVE:101'] = OTHER_USER_ID
  state.profileAssociations['LIVE:202'] = OTHER_USER_ID
  await saveCloudState(storePath, state)
  const api = new FakeCloudApi()
  const localProfiles: OwnershipSyncProfile[] = ['101', '202'].map((accountId) => ({
    channel: 'LIVE',
    accountId,
    handle: `Pilot${accountId}`,
    receipts: [0, 1].map((index) => ({
      normalizedName: `receipt ${accountId} ${index}`,
      name: `Receipt ${accountId} ${index}`,
      firstSeenAt: NOW,
      lastSeenAt: NOW
    })),
    manualBlueprints: []
  }))
  const controller = new CloudSyncController({
    storePath,
    apiUrl: 'http://127.0.0.1:5050',
    appVersion: '0.1.11',
    deviceName: 'Gaming PC',
    tokenProtector: protector(),
    getLocalProfiles: () => localProfiles,
    getActiveProfile: () => ({ channel: 'LIVE', accountId: '101', handle: 'Pilot101' }),
    openExternal: () => Promise.resolve(),
    onStateChange: () => undefined,
    onOwnershipChange: () => undefined,
    apiFactory: () => api,
    now: () => new Date(NOW),
    sleep: () => Promise.resolve(),
    syncIntervalMs: 60 * 60 * 1_000,
    maxPendingOperations: 2
  })

  try {
    await controller.initialize()
    await controller.beginLogin()
    const initial = await controller.completeLoginCode('handoff-code')
    assert.equal(initial.blockedProfileCount, 2)

    const confirmed = await controller.confirmProfileImport()
    assert.equal(confirmed.status, 'synced')
    assert.equal(confirmed.blockedProfileCount, 0)
    assert.equal(
      api.syncedOperations.filter((operation) => operation.kind === 'receipt.upsert').length,
      4
    )
    const persisted = await loadCloudState(storePath)
    assert.equal(persisted.state.profileAssociations['LIVE:101'], USER_ID)
    assert.equal(persisted.state.profileAssociations['LIVE:202'], USER_ID)
  } finally {
    controller.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test('blocks static publication for a non-admin session before transport', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rockfall-cloud-sync-user-'))
  const api = new FakeCloudApi()
  api.role = 'user'
  const controller = new CloudSyncController({
    storePath: join(directory, 'cloud-state.json'),
    apiUrl: 'http://127.0.0.1:5050',
    appVersion: '0.1.11',
    deviceName: 'Gaming PC',
    tokenProtector: protector(),
    getLocalProfiles: () => [],
    getActiveProfile: () => null,
    openExternal: () => Promise.resolve(),
    onStateChange: () => undefined,
    onOwnershipChange: () => undefined,
    apiFactory: () => api,
    now: () => new Date(NOW),
    sleep: () => Promise.resolve(),
    syncIntervalMs: 60 * 60 * 1_000
  })

  try {
    await controller.initialize()
    await controller.beginLogin()
    await controller.completeLoginCode('handoff-code')
    const overview = await controller.getStaticDataOverview('LIVE')
    assert.equal(overview.canPublish, false)
    assert.equal(controller.getSnapshot().user?.role, 'user')
    await assert.rejects(
      controller.publishStaticDataRelease(Buffer.from('archive')),
      (reason: unknown) =>
        reason instanceof Error &&
        reason.message === 'An administrator role is required to publish static data.'
    )
    assert.equal(api.publicationCount, 0)
  } finally {
    controller.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

class FakeCloudApi {
  createdLoginRequest: {
    installationId: string
    deviceName: string
    appVersion: string
  } | null = null
  exchanged: { requestSecret: string; handoffCode: string } | null = null
  syncedOperations: CloudSyncOperation[] = []
  refreshCount = 0
  publicationCount = 0
  publicationError: Error | null = null
  role: 'user' | 'admin' = 'admin'
  refreshError: Error | null = null
  snapshotProfiles: CloudOwnershipSnapshot['profiles'] = []
  private cursor = 0

  async createLoginRequest(input: {
    installationId: string
    deviceName: string
    appVersion: string
  }): Promise<{
    loginRequestId: string
    authorizeUrl: string
    requestSecret: string
    expiresAt: string
  }> {
    this.createdLoginRequest = input
    return {
      loginRequestId: LOGIN_ID,
      authorizeUrl: `http://127.0.0.1:5050/v1/auth/discord/login-requests/${LOGIN_ID}/authorize`,
      requestSecret: 'request-secret',
      expiresAt: LATER
    }
  }

  async exchangeLoginRequest(
    _loginRequestId: string,
    input: { requestSecret: string; handoffCode: string }
  ): Promise<CloudTokenPair> {
    this.exchanged = input
    return tokenPair(this.role)
  }

  async refresh(): Promise<CloudTokenPair> {
    this.refreshCount += 1
    if (this.refreshError) throw this.refreshError
    return tokenPair(this.role)
  }

  logout(): Promise<void> {
    return Promise.resolve()
  }

  async getOwnershipSnapshot(): Promise<CloudOwnershipSnapshot> {
    return { cursor: String(this.cursor), profiles: this.snapshotProfiles, serverTime: NOW }
  }

  async syncOwnership(
    _accessToken: string,
    input: { cursor: string; operations: CloudSyncOperation[] }
  ): Promise<CloudSyncResponse> {
    this.syncedOperations.push(...input.operations)
    const changes: CloudSyncResponse['changes'] = []
    if (input.operations.length > 0 && this.cursor === 0) {
      this.cursor += 1
      changes.push({
        cursor: String(this.cursor),
        kind: 'profile.upsert',
        profile: input.operations[0].profile
      })
    }
    for (const operation of input.operations) {
      this.cursor += 1
      changes.push(
        operation.kind === 'receipt.upsert'
          ? {
              cursor: String(this.cursor),
              kind: operation.kind,
              profile: operation.profile,
              receipt: {
                normalizedName: operation.receipt.name.toLowerCase(),
                ...operation.receipt
              }
            }
          : {
              cursor: String(this.cursor),
              kind: operation.kind,
              profile: operation.profile,
              manual: operation.manual
            }
      )
    }
    return {
      acknowledgedOperationIds: input.operations.map((operation) => operation.operationId),
      rejectedOperations: [],
      changes,
      nextCursor: String(this.cursor),
      hasMore: false,
      serverTime: NOW
    }
  }

  async publishStaticDataRelease(): Promise<CloudStaticDataPublishResult> {
    this.publicationCount += 1
    if (this.publicationError) throw this.publicationError
    return {
      status: 'published',
      releaseId: '71807306-2f44-44c2-ac7b-cf005fb0c962',
      contractVersion: 1,
      channel: 'LIVE',
      gameBuild: 'sc-alpha-4.9.0',
      gameVersion: '4.9.187.47267',
      contentSetSha256: 'a'.repeat(64),
      publishedAt: NOW,
      current: true,
      manifestUrl: '/v1/static-data/releases/71807306-2f44-44c2-ac7b-cf005fb0c962'
    }
  }

  async getStaticDataCapabilities(): Promise<CloudStaticDataCapabilities> {
    return { contractVersion: 1, role: this.role, canPublish: this.role === 'admin' }
  }

  async getCurrentStaticDataRelease(): Promise<CloudStaticDataCurrentRelease> {
    throw new CloudApiError('No release has been published.', {
      status: 404,
      code: 'static_data_not_published'
    })
  }
}

function tokenPair(role: 'user' | 'admin' = 'admin'): CloudTokenPair {
  return {
    tokenType: 'Bearer',
    accessToken: 'access-token',
    expiresIn: 600,
    refreshToken: 'refresh-token',
    refreshExpiresAt: LATER,
    user: {
      id: USER_ID,
      discordUserId: '80351110224678912',
      displayName: 'Nelly',
      avatarHash: null,
      role
    }
  }
}

function localProfile(): OwnershipSyncProfile {
  return {
    channel: 'LIVE',
    accountId: '123456789',
    handle: 'CurrentPilot',
    receipts: [
      {
        normalizedName: 'quadracell',
        name: 'QuadraCell',
        firstSeenAt: NOW,
        lastSeenAt: NOW
      }
    ],
    manualBlueprints: [{ blueprintId: 'duplicate-a', blueprintKey: 'duplicate-key-a' }]
  }
}

function protector(): RefreshTokenProtector {
  return {
    isEncryptionAvailable: () => true,
    encrypt: (value) => Buffer.from(`protected:${value}`).toString('base64'),
    decrypt: (value) => {
      const decrypted = Buffer.from(value, 'base64').toString('utf8')
      assert.ok(decrypted.startsWith('protected:'))
      return decrypted.slice('protected:'.length)
    }
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for cloud state.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
