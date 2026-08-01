import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { promises as fs } from 'node:fs'
import { tmpdir, type NetworkInterfaceInfo } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { MiningMaterial, OverlaySettings } from '../shared/contracts'
import type {
  LanCommandResponseV1,
  LanControlState,
  LanErrorResponseV1,
  LanInfoResponseV1,
  LanOverlayStateV1,
  LanPairingResponseV1
} from '../shared/lan-control'
import {
  LanControlServer,
  isLanAddress,
  type LanControlServerOptions,
  type LanDomainState
} from './lan-control-server'
import { LanControlStore, type LanSecretProtector } from './lan-control-store'
import { resolveOverlayCommand } from './overlay-commands'
import { DEFAULT_SETTINGS, mergeSettings } from './settings-store'

const materials: MiningMaterial[] = [
  {
    id: 'agricium-ore',
    commodityId: 'agricium-ore',
    name: 'Agricium',
    displayName: 'Agricium',
    signature: 3_885,
    methods: ['Ship'],
    catalogMaterialId: null,
    sourceUrl: 'https://example.test/agricium'
  },
  {
    id: 'riccite-ore--fps',
    commodityId: 'riccite-ore',
    name: 'Riccite (FPS)',
    displayName: 'Riccite (FPS)',
    signature: 3_385,
    methods: ['FPS'],
    catalogMaterialId: null,
    sourceUrl: 'https://example.test/riccite'
  }
]

const protector: LanSecretProtector = {
  isEncryptionAvailable: () => true,
  encrypt: (value) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value) => Buffer.from(value, 'base64').toString('utf8')
}

interface Harness {
  server: LanControlServer
  endpoint: string
  runtimeStates: LanControlState[]
  setSettings: (patch: Partial<OverlaySettings>) => void
  getSettings: () => OverlaySettings
  close: () => Promise<void>
}

interface HarnessOptions {
  beforeCommand?: () => Promise<void>
  getNetworkInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>
  createDiscovery?: LanControlServerOptions['createDiscovery']
  networkPollIntervalMs?: number
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'rockfall-lan-server-'))
  const store = new LanControlStore({
    path: join(directory, 'lan-control.json'),
    protector
  })
  let settings: OverlaySettings = {
    ...DEFAULT_SETTINGS,
    selectedMaterialIds: []
  }
  const runtimeStates: LanControlState[] = []
  const domainState = (): LanDomainState => ({
    catalog: {
      state: 'game',
      message: 'Loaded test signatures.',
      updatedAt: '2026-07-31T12:00:00.000Z',
      items: materials.map(({ id, commodityId, name, displayName, methods }) => ({
        id,
        commodityId,
        name,
        displayName,
        methods
      }))
    },
    overlay: {
      selectedItemIds: [...settings.selectedMaterialIds],
      compact: settings.compact,
      spotlightItemId: settings.spotlightMaterialId
    }
  })
  const server = new LanControlServer({
    store,
    deviceName: 'Test PC',
    appVersion: '1.2.3',
    listenHost: '127.0.0.1',
    getDomainState: domainState,
    executeCommand: async (command, context) => {
      await options.beforeCommand?.()
      context.assertExpected()
      const result = resolveOverlayCommand(command, settings, materials)
      if (result.patch) settings = mergeSettings(settings, result.patch)
      server.synchronizeState()
      return result.result
    },
    onRuntimeStateChange: (state) => runtimeStates.push(state),
    getNetworkInterfaces: options.getNetworkInterfaces,
    createDiscovery:
      options.createDiscovery ??
      (() => ({
        stop: async () => undefined
      })),
    networkPollIntervalMs: options.networkPollIntervalMs
  })
  await server.start(0)
  const endpoint = server.getRuntimeState().endpoints[0]
  assert.ok(endpoint)
  return {
    server,
    endpoint,
    runtimeStates,
    setSettings: (patch) => {
      settings = mergeSettings(settings, patch)
      server.synchronizeState()
    },
    getSettings: () => settings,
    close: async () => {
      await server.dispose()
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
}

test('serves info, pairs one device, authenticates, and applies all overlay operations', async () => {
  const harness = await createHarness()
  try {
    const info = await requestJson(harness.endpoint, '/api/v1/info')
    assert.equal(info.status, 200)
    const infoBody = info.body as unknown as LanInfoResponseV1
    assert.equal(infoBody.protocolVersion, 1)
    assert.match(infoBody.server.tlsSpkiSha256, /^sha256\//)

    const session = harness.server.beginPairing()
    const pairing = await requestJson(harness.endpoint, '/api/v1/pairings', {
      method: 'POST',
      body: {
        code: session.code,
        client: { name: 'Pixel', platform: 'android', appVersion: '1.0.0' }
      }
    })
    assert.equal(pairing.status, 201)
    const paired = pairing.body as unknown as LanPairingResponseV1
    assert.equal(paired.state.overlay.compact, false)
    const headers = { Authorization: `Bearer ${paired.accessToken}` }

    const stateResponse = await requestJson(harness.endpoint, '/api/v1/state', { headers })
    assert.equal(stateResponse.status, 200)
    let state = stateResponse.body as unknown as LanOverlayStateV1
    assert.deepEqual(state.overlay.selectedItemIds, [])
    assert.equal(state.catalog.items[1].id, 'riccite-ore--fps')

    const add = await sendCommand(harness.endpoint, headers, state, {
      operation: 'overlay.item.add',
      itemId: 'riccite-ore--fps'
    })
    assert.equal(add.status, 200)
    state = (add.body as unknown as LanCommandResponseV1).state
    assert.deepEqual(state.overlay.selectedItemIds, ['riccite-ore--fps'])

    const compact = await sendCommand(harness.endpoint, headers, state, {
      operation: 'overlay.compact.set',
      enabled: true
    })
    assert.equal(compact.status, 200)
    state = (compact.body as unknown as LanCommandResponseV1).state
    assert.equal(state.overlay.compact, true)

    const cycle = await sendCommand(harness.endpoint, headers, state, {
      operation: 'overlay.target.cycle'
    })
    assert.equal(cycle.status, 200)
    state = (cycle.body as unknown as LanCommandResponseV1).state
    assert.equal(state.overlay.spotlightItemId, 'riccite-ore--fps')

    const remove = await sendCommand(harness.endpoint, headers, state, {
      operation: 'overlay.item.remove',
      itemId: 'riccite-ore--fps'
    })
    assert.equal(remove.status, 200)
    state = (remove.body as unknown as LanCommandResponseV1).state
    assert.deepEqual(state.overlay.selectedItemIds, [])
    assert.equal(state.overlay.spotlightItemId, null)
  } finally {
    await harness.close()
  }
})

test('returns structured authentication, pairing, item, and revision errors', async () => {
  const harness = await createHarness()
  try {
    const unauthenticated = await requestJson(harness.endpoint, '/api/v1/state')
    assert.equal(unauthenticated.status, 401)
    assert.equal(errorCode(unauthenticated), 'authentication_required')

    const inactive = await requestJson(harness.endpoint, '/api/v1/pairings', {
      method: 'POST',
      body: {
        code: '123456',
        client: { name: 'Pixel', platform: 'android' }
      }
    })

    assert.equal(inactive.status, 403)
    assert.equal(errorCode(inactive), 'pairing_inactive')

    const session = harness.server.beginPairing()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rejected = await requestJson(harness.endpoint, '/api/v1/pairings', {
        method: 'POST',
        body: {
          code: session.code === '000000' ? '999999' : '000000',
          client: { name: 'Pixel', platform: 'android' }
        }
      })
      assert.equal(rejected.status, 403)
      assert.equal(errorCode(rejected), 'pairing_rejected')
    }
    const limited = await requestJson(harness.endpoint, '/api/v1/pairings', {
      method: 'POST',
      body: {
        code: session.code,
        client: { name: 'Pixel', platform: 'android' }
      }
    })
    assert.equal(limited.status, 429)
    assert.equal(errorCode(limited), 'pairing_rate_limited')

    harness.server.cancelPairing()
    const credential = await pair(harness)
    const headers = { Authorization: `Bearer ${credential.accessToken}` }
    const initial = credential.state

    const missing = await sendCommand(harness.endpoint, headers, initial, {
      operation: 'overlay.item.add',
      itemId: 'unknown'
    })
    assert.equal(missing.status, 404)
    assert.equal(errorCode(missing), 'item_not_found')

    harness.setSettings({ compact: true })
    const stale = await sendCommand(harness.endpoint, headers, initial, {
      operation: 'overlay.target.cycle'
    })
    assert.equal(stale.status, 409)
    const error = stale.body as unknown as LanErrorResponseV1
    assert.equal(error.error.code, 'revision_conflict')
    assert.equal(error.state?.overlay.compact, true)
  } finally {
    await harness.close()
  }
})

test('consumes a correct pairing code before persisting the first concurrent client', async () => {
  const harness = await createHarness()
  try {
    const session = harness.server.beginPairing()
    const body = {
      code: session.code,
      client: { name: 'Pixel', platform: 'android', appVersion: '1.0.0' }
    }
    const responses = await Promise.all([
      requestJson(harness.endpoint, '/api/v1/pairings', { method: 'POST', body }),
      requestJson(harness.endpoint, '/api/v1/pairings', { method: 'POST', body })
    ])
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 403])
    const rejected = responses.find((response) => response.status === 403)
    assert.ok(rejected)
    assert.equal(errorCode(rejected), 'pairing_inactive')
    assert.equal(harness.server.getRuntimeState().pairedClients.length, 1)
  } finally {
    await harness.close()
  }
})

test('fences a queued command when the listener is disabled', async () => {
  let commandEntered = (): void => undefined
  let releaseCommand = (): void => undefined
  const entered = new Promise<void>((resolve) => {
    commandEntered = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    releaseCommand = resolve
  })
  const harness = await createHarness({
    beforeCommand: async () => {
      commandEntered()
      await blocked
    }
  })
  try {
    const credential = await pair(harness)
    const command = sendCommand(
      harness.endpoint,
      { Authorization: `Bearer ${credential.accessToken}` },
      credential.state,
      { operation: 'overlay.compact.set', enabled: true }
    ).catch(() => null)
    await entered
    const stopping = harness.server.stop()
    await new Promise((resolve) => setImmediate(resolve))
    releaseCommand()
    const response = await command
    await stopping

    if (response) {
      assert.equal(response.status, 503)
      assert.equal(errorCode(response), 'service_stopping')
    }
    assert.equal(harness.getSettings().compact, false)
  } finally {
    await harness.close()
  }
})

test('loads and revokes paired credentials while the listener stays disabled', async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'rockfall-lan-disabled-'))
  try {
    const path = join(directory, 'lan-control.json')
    const initialStore = new LanControlStore({ path, protector })
    await initialStore.initialize()
    const credential = await initialStore.pairClient({
      code: '123456',
      client: { name: 'Offline phone', platform: 'android', appVersion: null }
    })

    const runtimeStates: LanControlState[] = []
    const server = new LanControlServer({
      store: new LanControlStore({ path, protector }),
      deviceName: 'Test PC',
      appVersion: '1.2.3',
      getDomainState: () => ({
        catalog: {
          state: 'loading',
          message: 'Loading.',
          updatedAt: null,
          items: []
        },
        overlay: {
          selectedItemIds: [],
          compact: false,
          spotlightItemId: null
        }
      }),
      executeCommand: async () => 'noop',
      onRuntimeStateChange: (state) => runtimeStates.push(state),
      createDiscovery: () => ({ stop: async () => undefined })
    })
    await server.loadIdentityIfPresent()
    assert.equal(server.getRuntimeState().status, 'disabled')
    assert.equal(server.getRuntimeState().pairedClients[0].name, 'Offline phone')
    assert.equal(await server.revokeClient(credential.client.id), true)
    assert.deepEqual(server.getRuntimeState().pairedClients, [])
    await server.resetIdentity()
    assert.equal(server.getRuntimeState().status, 'disabled')
    assert.ok(runtimeStates.length > 0)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('streams initial and changed full states and closes a revoked client stream', async () => {
  const harness = await createHarness()
  let stream: ReturnType<typeof openEventStream> | null = null
  try {
    const credential = await pair(harness)
    stream = openEventStream(harness.endpoint, credential.accessToken)
    const initial = await stream.next()
    assert.equal(initial.overlay.compact, false)

    harness.setSettings({ compact: true })
    const changed = await stream.next()
    assert.equal(changed.overlay.compact, true)
    assert.ok(changed.revision > initial.revision)

    await harness.server.revokeClient(credential.clientId)
    await stream.closed
  } finally {
    stream?.close()
    await harness.close()
  }
})

test('rejects malformed and oversized JSON bodies', async () => {
  const harness = await createHarness()
  try {
    const malformed = await requestRaw(harness.endpoint, '/api/v1/pairings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{'
    })

    test('rejects unsupported API versions before authentication', async () => {
      const harness = await createHarness()
      try {
        const response = await requestJson(harness.endpoint, '/api/v2/info')
        assert.equal(response.status, 400)
        assert.equal(errorCode(response), 'unsupported_version')
      } finally {
        await harness.close()
      }
    })
    assert.equal(malformed.status, 400)
    assert.equal(JSON.parse(malformed.body).error.code, 'invalid_json')

    const oversized = await requestRaw(harness.endpoint, '/api/v1/pairings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(17 * 1_024) })
    })
    assert.equal(oversized.status, 413)
    assert.equal(JSON.parse(oversized.body).error.code, 'payload_too_large')
  } finally {
    await harness.close()
  }
})

test('recognizes only loopback, RFC1918, and IPv4 link-local peers', () => {
  for (const address of [
    '127.0.0.1',
    '10.20.30.40',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.10',
    '169.254.1.2',
    '::ffff:192.168.1.10'
  ]) {
    assert.equal(isLanAddress(address), true, address)
  }
  for (const address of ['8.8.8.8', '172.32.0.1', '192.0.2.1', '::1', 'invalid']) {
    assert.equal(isLanAddress(address), false, address)
  }
})

test('refreshes manual endpoints and republishes discovery after an address change', async () => {
  let address = '192.168.1.20'
  let publicationCount = 0
  let stopCount = 0
  const harness = await createHarness({
    getNetworkInterfaces: () => ({
      WiFi: [
        {
          address,
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:11:22:33:44:55',
          internal: false,
          cidr: `${address}/24`
        }
      ]
    }),
    createDiscovery: (options) => {
      publicationCount += 1
      queueMicrotask(options.onReady)
      return {
        stop: async () => {
          stopCount += 1
        }
      }
    },
    networkPollIntervalMs: 10
  })
  try {
    assert.ok(harness.server.getRuntimeState().endpoints.some((value) => value.includes(address)))
    address = '192.168.1.21'
    await waitFor(() => publicationCount >= 2)
    const endpoints = harness.server.getRuntimeState().endpoints
    assert.ok(endpoints.some((value) => value.includes('192.168.1.21')))
    assert.equal(
      endpoints.some((value) => value.includes('192.168.1.20')),
      false
    )
    assert.ok(stopCount >= 1)
  } finally {
    await harness.close()
  }
})

async function pair(harness: Harness): Promise<LanPairingResponseV1> {
  const session = harness.server.beginPairing()
  const response = await requestJson(harness.endpoint, '/api/v1/pairings', {
    method: 'POST',
    body: {
      code: session.code,
      client: { name: 'Pixel', platform: 'android', appVersion: '1.0.0' }
    }
  })
  assert.equal(response.status, 201)
  return response.body as unknown as LanPairingResponseV1
}

async function sendCommand(
  endpoint: string,
  headers: Record<string, string>,
  state: LanOverlayStateV1,
  operation: ParametersOnlyCommand
): Promise<JsonResponse> {
  return requestJson(endpoint, '/api/v1/commands', {
    method: 'POST',
    headers,
    body: {
      requestId: randomUUID(),
      expected: {
        runId: state.server.runId,
        revision: state.revision
      },
      ...operation
    }
  })
}

type ParametersOnlyCommand =
  | { operation: 'overlay.item.add'; itemId: string }
  | { operation: 'overlay.item.remove'; itemId: string }
  | { operation: 'overlay.compact.set'; enabled: boolean }
  | { operation: 'overlay.target.cycle' }

interface JsonResponse {
  status: number
  body: Record<string, unknown>
}

async function requestJson(
  endpoint: string,
  path: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
  } = {}
): Promise<JsonResponse> {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  const response = await requestRaw(endpoint, path, {
    method: options.method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    body
  })
  return {
    status: response.status,
    body: JSON.parse(response.body) as Record<string, unknown>
  }
}

function errorCode(response: JsonResponse): LanErrorResponseV1['error']['code'] {
  return (response.body as unknown as LanErrorResponseV1).error.code
}

function requestRaw(
  endpoint: string,
  path: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
  } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, endpoint)
    const requestOptions: RequestOptions = {
      method: options.method ?? 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      rejectUnauthorized: false,
      headers: options.headers
    }
    const request = httpsRequest(requestOptions, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8')
        })
      )
    })
    request.on('error', reject)
    if (options.body) request.write(options.body)
    request.end()
  })
}

function openEventStream(
  endpoint: string,
  accessToken: string
): {
  next: () => Promise<LanOverlayStateV1>
  close: () => void
  closed: Promise<void>
} {
  const values: LanOverlayStateV1[] = []
  const waiters: Array<(state: LanOverlayStateV1) => void> = []
  let buffer = ''
  let closeRequest = (): void => undefined
  let resolveClosed = (): void => undefined
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })

  const url = new URL('/api/v1/events', endpoint)
  const request = httpsRequest(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      rejectUnauthorized: false,
      headers: { Authorization: `Bearer ${accessToken}` }
    },
    (response) => {
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        buffer += chunk
        let separator = buffer.indexOf('\n\n')
        while (separator >= 0) {
          const block = buffer.slice(0, separator)
          buffer = buffer.slice(separator + 2)
          const data = block
            .split('\n')
            .find((line) => line.startsWith('data: '))
            ?.slice('data: '.length)
          if (data) {
            const state = JSON.parse(data) as LanOverlayStateV1
            const waiter = waiters.shift()
            if (waiter) waiter(state)
            else values.push(state)
          }

          separator = buffer.indexOf('\n\n')
        }
      })
      response.on('close', resolveClosed)
      response.on('end', resolveClosed)
      closeRequest = () => response.destroy()
    }
  )
  request.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') throw error
    resolveClosed()
  })
  request.end()

  return {
    next: () => {
      const value = values.shift()
      return value
        ? Promise.resolve(value)
        : new Promise<LanOverlayStateV1>((resolve) => waiters.push(resolve))
    },
    close: () => {
      closeRequest()
      request.destroy()
    },
    closed
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for the expected LAN state.')
}
