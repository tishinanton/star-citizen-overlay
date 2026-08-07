import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import {
  CloudApiClient,
  CloudApiError,
  CloudNetworkError,
  type CloudManualSetOperation,
  type CloudReceiptUpsertOperation
} from './cloud-api'
import { normalizeCloudApiUrl } from './cloud-url'

const USER_ID = '8d301e3e-6fd2-4900-a671-b20d48ab8403'
const LOGIN_ID = 'b43fe4e9-9f00-49f7-8290-46a59bd8c2e2'
const DEVICE_ID = 'b7b8dd5b-b330-45b9-b17f-76c723e586c4'
const INSTALLATION_ID = 'a555284b-bf65-4558-a63b-a445477aec7f'
const PROFILE_ID = '22280eef-dce1-48ca-964f-8f11ddaf5e65'
const RECEIPT_OPERATION_ID = '2cb9a205-5f55-4eb7-a090-29d7179af37b'
const MANUAL_OPERATION_ID = 'dcce9004-989e-458f-b0a2-2359347b94a7'
const RELEASE_ID = '71807306-2f44-44c2-ac7b-cf005fb0c962'
const NOW = '2026-07-27T16:55:00.000Z'

test('normalizes service, Swagger, and local development URLs', () => {
  assert.equal(
    normalizeCloudApiUrl('https://api.rockfall.example/'),
    'https://api.rockfall.example'
  )
  assert.equal(
    normalizeCloudApiUrl('https://localhost:7065/swagger/index.html'),
    'https://localhost:7065'
  )
  assert.equal(normalizeCloudApiUrl('http://127.0.0.1:5050'), 'http://127.0.0.1:5050')
  assert.throws(() => normalizeCloudApiUrl('http://api.rockfall.example'), /must use HTTPS/)
  assert.throws(() => normalizeCloudApiUrl('https://api.rockfall.example/custom'), /service root/)
})

test('validates every Rockfall Cloud client method', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  const server = createServer(async (request, response) => {
    const body = await readBody(request)
    calls.push({
      method: request.method ?? '',
      path: request.url ?? '',
      body
    })

    handleRequest(request, response, body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const { port } = server.address() as AddressInfo
    const client = new CloudApiClient(`http://127.0.0.1:${port}`)
    const login = await client.createLoginRequest({
      installationId: INSTALLATION_ID,
      deviceName: 'Gaming PC',
      appVersion: '0.1.11'
    })
    assert.equal(login.loginRequestId, LOGIN_ID)

    const exchanged = await client.exchangeLoginRequest(LOGIN_ID, {
      requestSecret: 'request-secret',
      handoffCode: 'handoff-code'
    })
    assert.equal(exchanged.user.displayName, 'Nelly')
    assert.equal(exchanged.expiresIn, 600)

    const refreshed = await client.refresh('refresh-token')
    assert.equal(refreshed.accessToken, 'access-token')
    const account = await client.getAccount(refreshed.accessToken)
    assert.equal(account.id, USER_ID)
    const devices = await client.getDevices(refreshed.accessToken)
    assert.equal(devices[0].current, true)
    await client.revokeDevice(DEVICE_ID, refreshed.accessToken)
    const exported = await client.exportAccount(refreshed.accessToken)
    assert.equal(exported.devices.length, 1)

    const snapshot = await client.getOwnershipSnapshot(refreshed.accessToken)
    assert.equal(snapshot.profiles[0].receipts[0].normalizedName, 'quadracell')

    const receiptOperation: CloudReceiptUpsertOperation = {
      operationId: RECEIPT_OPERATION_ID,
      kind: 'receipt.upsert',
      profile: { channel: 'LIVE', accountId: '123456789', handle: 'CurrentPilot' },
      receipt: {
        name: 'QuadraCell',
        firstSeenAt: NOW,
        lastSeenAt: NOW
      }
    }
    const manualOperation: CloudManualSetOperation = {
      operationId: MANUAL_OPERATION_ID,
      kind: 'manual.set',
      profile: receiptOperation.profile,
      manual: {
        blueprintId: 'duplicate-a',
        blueprintKey: 'duplicate-key-a',
        owned: false,
        changedAt: NOW,
        blueprintKeyIsUnique: false
      }
    }
    const synced = await client.syncOwnership(refreshed.accessToken, {
      cursor: snapshot.cursor,
      operations: [receiptOperation, manualOperation]
    })
    assert.deepEqual(synced.acknowledgedOperationIds, [RECEIPT_OPERATION_ID, MANUAL_OPERATION_ID])
    assert.equal(synced.changes[0].kind, 'profile.upsert')
    assert.equal(synced.changes[1].kind, 'receipt.upsert')
    assert.equal(synced.changes[2].kind, 'manual.set')
    const archive = Buffer.from([0x50, 0x4b, 0x03, 0x04])
    const progress: number[] = []
    const published = await client.publishStaticDataRelease(
      refreshed.accessToken,
      archive,
      (sentBytes) => progress.push(sentBytes)
    )
    assert.equal(published.status, 'published')
    assert.deepEqual(progress, [0, archive.byteLength])

    await client.logout('refresh-token')
    await client.logoutAll(refreshed.accessToken)
    await client.deleteAccount(refreshed.accessToken)

    assert.equal(calls.length, 13)
    assert.deepEqual(calls[0].body, {
      installationId: INSTALLATION_ID,
      deviceName: 'Gaming PC',
      appVersion: '0.1.11'
    })
    assert.deepEqual(calls[8].body, {
      cursor: '4219',
      operations: [receiptOperation, manualOperation]
    })
    assert.deepEqual(calls[9].body, archive)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('validates static-data capability and current-release contracts', async () => {
  let useLegacyCapabilities = false
  let useOldResourceCaps = false
  let blueprintAuthorization: string | undefined
  let blueprintResource: unknown = [
    { id: 'Case-Sensitive-ID', isNew: true },
    { id: 'case-sensitive-id', isNew: false }
  ]
  const server = createServer((request, response) => {
    if (request.url === '/v1/static-data/capabilities') {
      if (useLegacyCapabilities) {
        writeJson(response, 200, {
          contractVersion: 1,
          role: 'admin',
          canPublish: true,
          requiredResources: {
            signatures: [1],
            blueprints: [1],
            'faction-reputation': [1]
          },
          assetMediaTypes: ['image/png'],
          limits: {}
        })
        return
      }
      writeJson(response, 200, {
        contractVersion: 1,
        role: 'admin',
        canPublish: true,
        upload: {
          method: 'POST',
          path: '/v1/admin/static-data/releases',
          mediaType: 'application/zip',
          maxArchiveBytes: 134_217_728
        },
        requiredResources: [
          { name: 'signatures', schemaVersions: [1], maxRecords: 128 },
          {
            name: 'blueprints',
            schemaVersions: [1],
            maxRecords: useOldResourceCaps ? 5_000 : 2_500
          },
          {
            name: 'faction-reputation',
            schemaVersions: [1],
            maxRecords: useOldResourceCaps ? 500 : 100
          }
        ],
        supportedAssetMediaTypes: ['image/png']
      })
      return
    }
    if (request.url === `/v1/static-data/releases/${RELEASE_ID}/resources/blueprints`) {
      blueprintAuthorization = request.headers.authorization
      const body = gzipSync(JSON.stringify(blueprintResource))
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': body.byteLength
      })
      response.end(body)
      return
    }
    if (request.url === '/v1/static-data/channels/LIVE/current') {
      writeJson(response, 200, {
        releaseId: RELEASE_ID,
        contractVersion: 1,
        channel: 'LIVE',
        gameBuild: '4.9.187.47267-LIVE',
        gameVersion: 'sc-alpha-4.9.0',
        generatedAt: NOW,
        sourceAppVersion: '0.2.0',
        contentSetSha256: 'a'.repeat(64),
        publishedAt: NOW,
        source: {
          dataP4kBytes: 158_000_000_000,
          dataP4kLastWriteAt: NOW
        },
        resources: [
          resource('signatures', 38),
          resource('blueprints', 1_591),
          resource('faction-reputation', 38)
        ],
        assets: [
          {
            key: `blueprint-icons/${'c'.repeat(64)}.png`,
            mediaType: 'image/png',
            sha256: 'c'.repeat(64),
            byteLength: 70,
            width: 1,
            height: 1,
            url: `/v1/static-data/assets/${'c'.repeat(64)}.png`
          }
        ]
      })
      return
    }
    writeJson(response, 404, { code: 'not_found' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const { port } = server.address() as AddressInfo
    const client = new CloudApiClient(`http://127.0.0.1:${port}`)
    const capabilities = await client.getStaticDataCapabilities('access-token')
    assert.equal(capabilities.canPublish, true)
    const current = await client.getCurrentStaticDataRelease('LIVE', 'access-token')
    assert.equal(current.releaseId, RELEASE_ID)
    assert.equal(current.manifestUrl, `/v1/static-data/releases/${RELEASE_ID}`)
    assert.equal(
      current.resources.blueprints.url,
      `/v1/static-data/releases/${RELEASE_ID}/resources/blueprints`
    )
    assert.deepEqual(
      await client.getStaticDataBlueprintMarkers(current.resources.blueprints, 'access-token'),
      [
        { id: 'Case-Sensitive-ID', isNew: true },
        { id: 'case-sensitive-id', isNew: false }
      ]
    )
    assert.equal(blueprintAuthorization, 'Bearer access-token')
    blueprintResource = [{ id: 'missing-marker' }]
    await assert.rejects(
      client.getStaticDataBlueprintMarkers(current.resources.blueprints, 'access-token'),
      /new state must be a boolean/
    )
    useOldResourceCaps = true
    await assert.rejects(
      client.getStaticDataCapabilities('access-token'),
      /incompatible static-data resource set/
    )
    useOldResourceCaps = false
    useLegacyCapabilities = true
    await assert.rejects(
      client.getStaticDataCapabilities('access-token'),
      /must contain exactly the documented fields/
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('surfaces Problem Details without accepting success-shaped failures', async () => {
  const server = createServer((_request, response) => {
    writeJson(response, 401, {
      title: 'Authentication failed.',
      detail: 'The refresh token is no longer valid.',
      code: 'refresh_token_invalid'
    })

    test('rejects an interrupted response instead of leaving the request pending', async () => {
      const server = createServer((_request, response) => {
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': '500'
        })

        test('accepts ownership snapshots larger than the default response cap', async () => {
          const server = createServer((_request, response) => {
            writeJson(response, 200, {
              cursor: '0',
              profiles: [],
              serverTime: NOW,
              padding: 'x'.repeat(9 * 1024 * 1024)
            })
          })
          await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

          try {
            const { port } = server.address() as AddressInfo
            const client = new CloudApiClient(`http://127.0.0.1:${port}`)
            const snapshot = await client.getOwnershipSnapshot('access-token')
            assert.equal(snapshot.cursor, '0')
          } finally {
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve()))
            )
          }
        })
        response.write('{"loginRequestId":"')
        response.destroy()
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

      try {
        const { port } = server.address() as AddressInfo
        const client = new CloudApiClient(`http://127.0.0.1:${port}`, { timeoutMs: 250 })
        await assert.rejects(
          client.createLoginRequest({
            installationId: INSTALLATION_ID,
            deviceName: 'Gaming PC',
            appVersion: '0.1.11'
          }),
          (reason: unknown) => reason instanceof CloudNetworkError
        )
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const { port } = server.address() as AddressInfo
    const client = new CloudApiClient(`http://127.0.0.1:${port}`)
    await assert.rejects(
      client.refresh('expired'),
      (reason: unknown) =>
        reason instanceof CloudApiError &&
        reason.status === 401 &&
        reason.code === 'refresh_token_invalid'
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

function handleRequest(request: IncomingMessage, response: ServerResponse, body: unknown): void {
  const path = request.url ?? ''
  if (request.method === 'POST' && path === '/v1/auth/discord/login-requests') {
    writeJson(response, 201, {
      loginRequestId: LOGIN_ID,
      authorizeUrl: `http://localhost/v1/auth/discord/login-requests/${LOGIN_ID}/authorize`,
      requestSecret: 'request-secret',
      expiresAt: NOW
    })
    return
  }
  if (
    request.method === 'POST' &&
    path === `/v1/auth/discord/login-requests/${LOGIN_ID}/exchange`
  ) {
    writeJson(response, 200, tokenPair())
    return
  }
  if (request.method === 'POST' && path === '/v1/auth/refresh') {
    writeJson(response, 200, tokenPair())
    return
  }
  if (request.method === 'POST' && path === '/v1/auth/logout') {
    assert.deepEqual(body, { refreshToken: 'refresh-token' })
    response.writeHead(204).end()
    return
  }
  if (request.method === 'POST' && path === '/v1/auth/logout-all') {
    response.writeHead(204).end()
    return
  }
  if (request.method === 'GET' && path === '/v1/account') {
    writeJson(response, 200, {
      ...tokenPair().user,
      createdAt: NOW,
      updatedAt: NOW,
      lastLoginAt: NOW
    })
    return
  }
  if (request.method === 'DELETE' && path === '/v1/account') {
    response.writeHead(204).end()
    return
  }
  if (request.method === 'GET' && path === '/v1/account/devices') {
    writeJson(response, 200, [device()])
    return
  }
  if (request.method === 'DELETE' && path === `/v1/account/devices/${DEVICE_ID}`) {
    response.writeHead(204).end()
    return
  }
  if (request.method === 'GET' && path === '/v1/account/export') {
    writeJson(response, 200, {
      account: {
        id: USER_ID,
        discordUserId: '80351110224678912',
        discordUsername: 'nelly',
        discordGlobalName: 'Nelly',
        discordAvatarHash: null,
        createdAt: NOW,
        updatedAt: NOW,
        lastLoginAt: NOW
      },
      devices: [device()],
      profiles: [],
      exportedAt: NOW
    })
    return
  }
  if (request.method === 'GET' && path === '/v1/ownership/snapshot') {
    writeJson(response, 200, ownershipSnapshot())
    return
  }
  if (request.method === 'POST' && path === '/v1/ownership/sync') {
    writeJson(response, 200, {
      acknowledgedOperationIds: [RECEIPT_OPERATION_ID, MANUAL_OPERATION_ID],
      rejectedOperations: [],
      changes: [
        {
          cursor: '4220',
          kind: 'profile.upsert',
          profile: { channel: 'LIVE', accountId: '123456789', handle: 'CurrentPilot' }
        },
        {
          cursor: '4221',
          kind: 'receipt.upsert',
          profile: { channel: 'LIVE', accountId: '123456789', handle: 'CurrentPilot' },
          receipt: {
            normalizedName: 'quadracell',
            name: 'QuadraCell',
            firstSeenAt: NOW,
            lastSeenAt: NOW
          }
        },
        {
          cursor: '4222',
          kind: 'manual.set',
          profile: { channel: 'LIVE', accountId: '123456789', handle: 'CurrentPilot' },
          manual: {
            blueprintId: 'duplicate-a',
            blueprintKey: 'duplicate-key-a',
            owned: false,
            changedAt: NOW
          }
        }
      ],
      nextCursor: '4222',
      hasMore: false,
      serverTime: NOW
    })
    return
  }
  if (request.method === 'POST' && path === '/v1/admin/static-data/releases') {
    assert.equal(request.headers['content-type'], 'application/zip')
    writeJson(response, 201, {
      status: 'published',
      releaseId: RELEASE_ID,
      contractVersion: 1,
      channel: 'LIVE',
      gameBuild: '4.9.187.47267-LIVE',
      gameVersion: 'sc-alpha-4.9.0',
      contentSetSha256: 'a'.repeat(64),
      publishedAt: NOW,
      current: true,
      manifestUrl: `/v1/static-data/releases/${RELEASE_ID}`
    })
    return
  }
  writeJson(response, 404, { title: 'Not found', code: 'not_found' })
}

function tokenPair(): Record<string, unknown> & { user: Record<string, unknown> } {
  return {
    tokenType: 'Bearer',
    accessToken: 'access-token',
    expiresIn: 600,
    refreshToken: 'refresh-token',
    refreshExpiresAt: '2026-08-26T16:55:00.000Z',
    user: {
      id: USER_ID,
      discordUserId: '80351110224678912',
      displayName: 'Nelly',
      avatarHash: null,
      role: 'admin'
    }
  }
}

function device(): Record<string, unknown> {
  return {
    id: DEVICE_ID,
    installationId: INSTALLATION_ID,
    name: 'Gaming PC',
    appVersion: '0.1.11',
    createdAt: NOW,
    lastSeenAt: NOW,
    revokedAt: null,
    current: true
  }
}

function ownershipSnapshot(): Record<string, unknown> {
  return {
    cursor: '4219',
    profiles: [
      {
        profileId: PROFILE_ID,
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
        manualBlueprints: []
      }
    ],
    serverTime: NOW
  }
}

function resource(name: string, recordCount: number): Record<string, unknown> {
  return {
    name,
    schemaVersion: 1,
    mediaType: 'application/json',
    contentEncoding: 'gzip',
    sha256: 'b'.repeat(64),
    compressedBytes: 1,
    uncompressedBytes: 1,
    recordCount,
    url: `/v1/static-data/releases/${RELEASE_ID}/resources/${name}`
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const contents = Buffer.concat(chunks)
  if (request.headers['content-type'] === 'application/zip') return contents
  const text = contents.toString('utf8')
  return text.length > 0 ? (JSON.parse(text) as unknown) : null
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const contents = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(contents)
  })
  response.end(contents)
}
