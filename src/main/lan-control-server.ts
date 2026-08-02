import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import { createServer, type Server as HttpsServer } from 'node:https'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'

import Bonjour, { type Service as BonjourService } from 'bonjour-service'

import {
  LAN_PROTOCOL_VERSION,
  MAX_LAN_EVENT_STREAMS,
  type LanApiErrorCode,
  type LanCommandRequestV1,
  type LanCommandResponseV1,
  type LanControlState,
  type LanErrorResponseV1,
  type LanInfoResponseV1,
  type LanOverlayCommandV1,
  type LanOverlayStateV1,
  type LanPairedClientSummary,
  type LanPairingResponseV1,
  type LanPairingSession,
  parseLanCommandRequest,
  parseLanPairingRequest
} from '../shared/lan-control'
import { LanClientCapacityError, LanControlStore, type LanTlsIdentity } from './lan-control-store'
import { OverlayCommandError } from './overlay-commands'

const REQUEST_BODY_LIMIT = 16 * 1_024
const PAIRING_DURATION_MS = 5 * 60 * 1_000
const MAX_PAIRING_ATTEMPTS = 5
const MAX_PAIRING_ATTEMPTS_PER_ADDRESS = 3
const SSE_KEEPALIVE_MS = 15_000
const CAPABILITIES: LanOverlayCommandV1['operation'][] = [
  'overlay.item.add',
  'overlay.item.remove',
  'overlay.compact.set',
  'overlay.target.cycle'
]

export interface LanDomainState {
  catalog: LanOverlayStateV1['catalog']
  overlay: Omit<LanOverlayStateV1['overlay'], 'maxSelectedItems'>
}

interface PairingState {
  code: string
  expiresAt: number
  attempts: number
  attemptsByAddress: Map<string, number>
  timer: NodeJS.Timeout
}

interface EventStream {
  clientId: string
  response: ServerResponse
  keepalive: NodeJS.Timeout
  backpressured: boolean
  pendingState: LanOverlayStateV1 | null
}

export interface LanCommandExecutionContext {
  assertExpected: () => void
}

export interface LanControlServerOptions {
  store: LanControlStore
  deviceName: string
  appVersion: string
  getDomainState: () => LanDomainState
  executeCommand: (
    command: LanCommandRequestV1,
    context: LanCommandExecutionContext
  ) => Promise<'applied' | 'noop'>
  onRuntimeStateChange: (state: LanControlState) => void
  listenHost?: string
  getNetworkInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>
  createDiscovery?: (options: LanDiscoveryOptions) => LanDiscoveryPublisher
  networkPollIntervalMs?: number
}

export interface LanDiscoveryOptions {
  port: number
  deviceName: string
  identity: LanTlsIdentity
  onError: (error: Error) => void
  onReady: () => void
}

export interface LanDiscoveryPublisher {
  stop: () => Promise<void>
}

export class LanRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: LanApiErrorCode,
    message: string,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
    readonly includeState = false
  ) {
    super(message)
    this.name = 'LanRequestError'
  }
}

export class LanControlServer {
  private readonly store: LanControlStore
  private readonly deviceName: string
  private readonly appVersion: string
  private readonly getDomainState: () => LanDomainState
  private readonly executeCommand: LanControlServerOptions['executeCommand']
  private readonly onRuntimeStateChange: (state: LanControlState) => void
  private readonly listenHost: string
  private readonly getNetworkInterfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>
  private readonly createDiscovery: (options: LanDiscoveryOptions) => LanDiscoveryPublisher
  private readonly networkPollIntervalMs: number
  private runId = randomUUID()
  private server: HttpsServer | null = null
  private discovery: LanDiscoveryPublisher | null = null
  private discoveryRefresh: Promise<void> = Promise.resolve()
  private discoveryFailure: string | null = null
  private networkMonitor: NodeJS.Timeout | null = null
  private networkAddressFingerprint = ''
  private identity: LanTlsIdentity | null = null
  private port = 0
  private requestedPort = 0
  private requestedEnabled = false
  private status: LanControlState['status'] = 'disabled'
  private message = 'LAN control is disabled.'
  private pairing: PairingState | null = null
  private revision = 0
  private domainFingerprint: string | null = null
  private state: LanOverlayStateV1 | null = null
  private eventStreams = new Set<EventStream>()
  private requestIds = new WeakMap<IncomingMessage, string>()
  private stopping = false
  private lifecycleGeneration = 0

  constructor(options: LanControlServerOptions) {
    this.store = options.store
    this.deviceName = options.deviceName
    this.appVersion = options.appVersion
    this.getDomainState = options.getDomainState
    this.executeCommand = options.executeCommand
    this.onRuntimeStateChange = options.onRuntimeStateChange
    this.listenHost = options.listenHost ?? '0.0.0.0'
    this.getNetworkInterfaces = options.getNetworkInterfaces ?? networkInterfaces
    this.createDiscovery =
      options.createDiscovery ??
      ((discoveryOptions) => new BonjourDiscoveryPublisher(discoveryOptions))
    this.networkPollIntervalMs = options.networkPollIntervalMs ?? 10_000
  }

  async start(port: number): Promise<void> {
    if (this.server && this.port === port && !this.stopping) return
    if (this.server || this.stopping) await this.stop()

    this.lifecycleGeneration += 1
    this.requestedEnabled = true
    this.requestedPort = port
    this.status = 'starting'
    this.message = 'Starting secure LAN control...'
    this.emitRuntimeState()

    try {
      const identity = await this.store.initialize()
      this.identity = identity
      const server = createServer(
        {
          cert: identity.certificatePem,
          key: identity.privateKeyPem,
          minVersion: 'TLSv1.2'
        },
        (request, response) => {
          void this.handleRequest(request, response).catch((error: unknown) => {
            this.handleUnexpectedRequestError(request, response, error)
          })
        }
      )
      server.maxHeadersCount = 50
      server.headersTimeout = 10_000
      server.requestTimeout = 15_000
      server.keepAliveTimeout = 5_000
      await listen(server, port, this.listenHost)
      server.on('error', (error) => {
        if (this.server !== server || this.stopping) return
        if (this.pairing) {
          clearTimeout(this.pairing.timer)
          this.pairing = null
        }
        this.status = 'error'
        this.message = `The secure LAN listener failed: ${error.message}`
        this.emitRuntimeState()
      })
      this.server = server
      this.port = (server.address() as AddressInfo).port
      this.status = 'listening'
      this.message = 'Secure LAN control is ready.'
      this.discoveryFailure = null
      this.synchronizeState(true)

      this.publishDiscovery(identity)
      this.networkAddressFingerprint = this.getNetworkAddresses().join('|')
      this.startNetworkMonitor()
      this.emitRuntimeState()
    } catch (error) {
      await this.closeResources()
      this.status = 'error'
      this.message = error instanceof Error ? error.message : String(error)
      this.emitRuntimeState()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1
    this.requestedEnabled = false
    this.stopping = true
    this.stopNetworkMonitor()
    this.cancelPairing()
    await this.discoveryRefresh
    await this.closeResources()
    this.stopping = false
    this.status = 'disabled'
    this.message = 'LAN control is disabled.'
    this.discoveryFailure = null
    this.port = 0
    this.emitRuntimeState()
  }

  async restart(port: number): Promise<void> {
    await this.stop()
    await this.start(port)
  }

  async dispose(): Promise<void> {
    await this.stop()
  }

  async loadIdentityIfPresent(): Promise<void> {
    try {
      const identity = await this.store.initializeExisting()
      if (!identity) return
      this.identity = identity
      this.emitRuntimeState()
    } catch (error) {
      this.status = 'error'
      this.message = error instanceof Error ? error.message : String(error)
      this.emitRuntimeState()
      throw error
    }
  }

  beginPairing(): LanPairingSession {
    if (!this.server || !this.identity || this.stopping) {
      throw new LanRequestError(
        503,
        'service_stopping',
        'Enable LAN control and wait for the secure listener before pairing.'
      )
    }
    this.cancelPairing()
    const expiresAt = Date.now() + PAIRING_DURATION_MS
    const timer = setTimeout(() => this.cancelPairing(), PAIRING_DURATION_MS)
    timer.unref()
    this.pairing = {
      code: randomInt(0, 1_000_000).toString().padStart(6, '0'),
      expiresAt,
      attempts: 0,
      attemptsByAddress: new Map(),
      timer
    }
    this.emitRuntimeState()
    return {
      code: this.pairing.code,
      expiresAt: new Date(expiresAt).toISOString(),
      endpoints: this.getEndpoints(),
      serverId: this.identity.serverId,
      tlsSpkiSha256: this.identity.tlsSpkiSha256,
      verificationCode: this.identity.verificationCode
    }
  }

  cancelPairing(): void {
    if (!this.pairing) return
    clearTimeout(this.pairing.timer)
    this.pairing = null
    this.emitRuntimeState()
  }

  async revokeClient(clientId: string): Promise<boolean> {
    const revoked = await this.store.revokeClient(clientId)
    if (!revoked) return false
    for (const stream of [...this.eventStreams]) {
      if (stream.clientId === clientId) this.closeEventStream(stream)
    }
    this.emitRuntimeState()
    return true
  }

  async resetIdentity(): Promise<void> {
    const wasEnabled = this.requestedEnabled
    const port = this.requestedPort
    await this.stop()
    try {
      this.identity = await this.store.reset()
      this.runId = randomUUID()
      this.revision = 0
      this.domainFingerprint = null
      this.state = null
      if (wasEnabled) {
        await this.start(port)
      } else {
        this.emitRuntimeState()
      }
    } catch (error) {
      this.requestedEnabled = wasEnabled
      this.status = 'error'
      this.message = error instanceof Error ? error.message : String(error)
      this.emitRuntimeState()
      throw error
    }
  }

  getRuntimeState(): LanControlState {
    const pairingActive = this.pairing !== null && this.pairing.expiresAt > Date.now()
    const status =
      pairingActive && (this.status === 'listening' || this.status === 'degraded')
        ? 'pairing'
        : this.status
    return {
      status,
      enabled: this.requestedEnabled,
      port: this.port || this.requestedPort,
      endpoints: this.getEndpoints(),
      serverId: this.identity?.serverId ?? null,
      tlsSpkiSha256: this.identity?.tlsSpkiSha256 ?? null,
      verificationCode: this.identity?.verificationCode ?? null,
      pairingExpiresAt: pairingActive ? new Date(this.pairing?.expiresAt ?? 0).toISOString() : null,
      pairedClients: this.identity ? this.store.getClients() : [],
      message: pairingActive
        ? `Pairing is open until ${new Date(this.pairing?.expiresAt ?? 0).toLocaleTimeString()}.`
        : this.message
    }
  }

  getState(): LanOverlayStateV1 {
    return this.synchronizeState()
  }

  synchronizeState(force = false): LanOverlayStateV1 {
    const identity = this.identity
    if (!identity) {
      throw new LanRequestError(503, 'service_stopping', 'LAN control is not initialized.')
    }
    const domain = this.getDomainState()
    const fingerprint = JSON.stringify({
      serverId: identity.serverId,
      deviceName: this.deviceName,
      appVersion: this.appVersion,
      domain
    })
    if (this.state && !force && this.domainFingerprint === fingerprint) return this.state
    if (this.state) this.revision += 1
    this.domainFingerprint = fingerprint
    this.state = {
      protocolVersion: LAN_PROTOCOL_VERSION,
      server: {
        id: identity.serverId,
        runId: this.runId,
        name: this.deviceName,
        appVersion: this.appVersion
      },
      revision: this.revision,
      catalog: structuredClone(domain.catalog),
      overlay: {
        ...structuredClone(domain.overlay),
        maxSelectedItems: domain.catalog.items.length
      }
    }
    this.broadcastState(this.state)
    return this.state
  }

  assertExpected(expected: LanCommandRequestV1['expected']): void {
    const state = this.getState()
    if (expected.runId !== state.server.runId || expected.revision !== state.revision) {
      throw new LanRequestError(
        409,
        'revision_conflict',
        'Overlay state changed before this command was applied.',
        true,
        {},
        true
      )
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestGeneration = this.lifecycleGeneration
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress)
    if (!remoteAddress || !isLanAddress(remoteAddress)) {
      throw new LanRequestError(
        403,
        'non_lan_peer',
        'LAN control accepts only local-network clients.'
      )
    }
    if (this.stopping) {
      throw new LanRequestError(503, 'service_stopping', 'LAN control is stopping.', true)
    }

    const url = new URL(request.url ?? '/', 'https://rockfall.local')
    if (url.search) {
      throw new LanRequestError(400, 'invalid_request', 'LAN routes do not accept URL parameters.')
    }
    if (/^\/api\/v[0-9]+(?:\/|$)/.test(url.pathname) && !url.pathname.startsWith('/api/v1/')) {
      throw new LanRequestError(
        400,
        'unsupported_version',
        `This desktop supports LAN protocol version ${LAN_PROTOCOL_VERSION}.`
      )
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/info') {
      this.writeJson(response, 200, this.getInfo())
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/pairings') {
      const body = parseLanPairingRequest(await this.readJson(request))
      const paired = await this.completePairing(body, remoteAddress)
      this.writeJson(response, 201, paired)
      return
    }

    const client = this.authenticate(request)
    if (request.method === 'GET' && url.pathname === '/api/v1/state') {
      this.writeJson(response, 200, this.getState())
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/events') {
      this.openEventStream(request, response, client)
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/commands') {
      let command: LanCommandRequestV1
      try {
        command = parseLanCommandRequest(await this.readJson(request))
        this.requestIds.set(request, command.requestId)
      } catch (error) {
        if (error instanceof RangeError) {
          throw new LanRequestError(400, 'unsupported_operation', error.message)
        }
        throw error
      }
      const result = await this.executeCommand(command, {
        assertExpected: () => this.assertCommandExpected(command.expected, requestGeneration)
      })
      const responseBody: LanCommandResponseV1 = {
        protocolVersion: LAN_PROTOCOL_VERSION,
        requestId: command.requestId,
        result,
        state: this.synchronizeState()
      }
      this.writeJson(response, 200, responseBody)
      return
    }

    throw new LanRequestError(404, 'route_not_found', 'That LAN control route does not exist.')
  }

  private getInfo(): LanInfoResponseV1 {
    const identity = this.identity
    if (!identity) {
      throw new LanRequestError(503, 'service_stopping', 'LAN control is not initialized.')
    }
    return {
      protocolVersion: LAN_PROTOCOL_VERSION,
      supportedProtocolVersions: [LAN_PROTOCOL_VERSION],
      server: {
        id: identity.serverId,
        name: this.deviceName,
        appVersion: this.appVersion,
        tlsSpkiSha256: identity.tlsSpkiSha256
      },
      pairing: {
        required: true,
        active: this.pairing !== null && this.pairing.expiresAt > Date.now()
      },
      capabilities: [...CAPABILITIES]
    }
  }

  private async completePairing(
    request: ReturnType<typeof parseLanPairingRequest>,
    remoteAddress: string
  ): Promise<LanPairingResponseV1> {
    const pairing = this.pairing
    if (!pairing || pairing.expiresAt <= Date.now()) {
      this.cancelPairing()
      throw new LanRequestError(403, 'pairing_inactive', 'Desktop pairing is not active.')
    }
    const addressAttempts = pairing.attemptsByAddress.get(remoteAddress) ?? 0
    if (
      pairing.attempts >= MAX_PAIRING_ATTEMPTS ||
      addressAttempts >= MAX_PAIRING_ATTEMPTS_PER_ADDRESS
    ) {
      throw new LanRequestError(
        429,
        'pairing_rate_limited',
        'Too many pairing attempts were made. Start a new desktop pairing session.'
      )
    }
    if (!safeCodeEquals(pairing.code, request.code)) {
      pairing.attempts += 1
      pairing.attemptsByAddress.set(remoteAddress, addressAttempts + 1)
      if (pairing.attempts >= MAX_PAIRING_ATTEMPTS) this.cancelPairing()
      throw new LanRequestError(403, 'pairing_rejected', 'The pairing code was not accepted.')
    }

    this.cancelPairing()
    let credential
    try {
      credential = await this.store.pairClient(request)
    } catch (error) {
      if (error instanceof LanClientCapacityError) {
        throw new LanRequestError(409, 'pairing_capacity_reached', error.message)
      }
      throw error
    }
    const identity = this.store.getIdentity()
    this.emitRuntimeState()
    return {
      protocolVersion: LAN_PROTOCOL_VERSION,
      clientId: credential.client.id,
      accessToken: credential.accessToken,
      server: {
        id: identity.serverId,
        name: this.deviceName,
        appVersion: this.appVersion,
        tlsSpkiSha256: identity.tlsSpkiSha256
      },
      state: this.getState()
    }
  }

  private authenticate(request: IncomingMessage): LanPairedClientSummary {
    const authorization = request.headers.authorization
    if (!authorization) {
      throw new LanRequestError(
        401,
        'authentication_required',
        'A paired-device credential is required.'
      )
    }
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(authorization)
    const client = match ? this.store.authenticate(match[1]) : null
    if (!client) {
      throw new LanRequestError(401, 'invalid_token', 'The paired-device credential is invalid.')
    }
    return client
  }

  private openEventStream(
    request: IncomingMessage,
    response: ServerResponse,
    client: LanPairedClientSummary
  ): void {
    if (this.eventStreams.size >= MAX_LAN_EVENT_STREAMS) {
      throw new LanRequestError(
        429,
        'pairing_rate_limited',
        'Too many LAN event streams are already connected.',
        true
      )
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    response.flushHeaders()
    const keepalive = setInterval(() => {
      if (!response.destroyed && !stream.backpressured) {
        this.writeEventData(stream, ': keepalive\n\n')
      }
    }, SSE_KEEPALIVE_MS)
    keepalive.unref()
    const stream: EventStream = {
      clientId: client.id,
      response,
      keepalive,
      backpressured: false,
      pendingState: null
    }
    this.eventStreams.add(stream)
    response.on('drain', () => this.drainEventStream(stream))
    response.on('error', () => this.closeEventStream(stream))
    this.writeStateEvent(stream, this.getState())
    request.on('close', () => this.closeEventStream(stream))
    response.on('close', () => this.closeEventStream(stream))
  }

  private broadcastState(state: LanOverlayStateV1): void {
    for (const stream of [...this.eventStreams]) {
      if (stream.response.destroyed) {
        this.closeEventStream(stream)
      } else if (stream.backpressured) {
        stream.pendingState = state
      } else {
        this.writeStateEvent(stream, state)
      }
    }
  }

  private writeStateEvent(stream: EventStream, state: LanOverlayStateV1): void {
    this.writeEventData(
      stream,
      `event: state\nid: ${state.server.runId}:${state.revision}\ndata: ${JSON.stringify(state)}\n\n`
    )
  }

  private writeEventData(stream: EventStream, value: string): void {
    try {
      if (!stream.response.write(value)) stream.backpressured = true
    } catch {
      this.closeEventStream(stream)
    }
  }

  private drainEventStream(stream: EventStream): void {
    if (!this.eventStreams.has(stream) || stream.response.destroyed) return
    stream.backpressured = false
    const pendingState = stream.pendingState
    stream.pendingState = null
    if (pendingState) this.writeStateEvent(stream, pendingState)
  }

  private closeEventStream(stream: EventStream): void {
    if (!this.eventStreams.delete(stream)) return
    clearInterval(stream.keepalive)
    if (!stream.response.destroyed) stream.response.end()
  }

  private assertCommandExpected(
    expected: LanCommandRequestV1['expected'],
    requestGeneration: number
  ): void {
    if (
      requestGeneration !== this.lifecycleGeneration ||
      !this.server ||
      !this.requestedEnabled ||
      this.stopping
    ) {
      throw new LanRequestError(
        503,
        'service_stopping',
        'LAN control changed while this command was waiting.',
        true
      )
    }
    this.assertExpected(expected)
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase()
    if (contentType !== 'application/json') {
      throw new LanRequestError(
        400,
        'invalid_request',
        'Request content type must be application/json.'
      )
    }
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    await new Promise<void>((resolve, reject) => {
      request.on('data', (chunk: Buffer) => {
        size += chunk.byteLength
        if (size > REQUEST_BODY_LIMIT) {
          tooLarge = true
          chunks.length = 0
        } else if (!tooLarge) {
          chunks.push(chunk)
        }
      })
      request.on('end', resolve)
      request.on('aborted', () => reject(new Error('The LAN request was aborted.')))
      request.on('error', reject)
    })
    if (tooLarge) {
      throw new LanRequestError(413, 'payload_too_large', 'LAN request body is too large.')
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      throw new LanRequestError(400, 'invalid_json', 'Request body is not valid JSON.')
    }
  }

  private writeJson(response: ServerResponse, status: number, value: unknown): void {
    if (response.headersSent || response.destroyed) return
    const body = Buffer.from(JSON.stringify(value), 'utf8')
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.byteLength
    })
    response.end(body)
  }

  private handleUnexpectedRequestError(
    request: IncomingMessage,
    response: ServerResponse,
    error: unknown
  ): void {
    if (response.headersSent || response.destroyed) {
      if (!response.destroyed) response.end()
      return
    }
    let requestError: LanRequestError
    if (error instanceof LanRequestError) {
      requestError = error
    } else if (error instanceof OverlayCommandError) {
      requestError = new LanRequestError(
        error.code === 'item_not_found' ? 404 : 503,
        error.code,
        error.message,
        error.code === 'catalog_unavailable',
        {},
        true
      )
    } else if (error instanceof TypeError || error instanceof RangeError) {
      requestError = new LanRequestError(400, 'invalid_request', error.message)
    } else {
      console.error('LAN control request failed.', error)
      requestError = new LanRequestError(
        500,
        'internal_error',
        'The desktop could not complete the LAN request.',
        true
      )
    }
    const requestId = this.requestIds.get(request) ?? readRequestIdHeader(request)
    const body: LanErrorResponseV1 = {
      protocolVersion: LAN_PROTOCOL_VERSION,
      requestId,
      error: {
        code: requestError.code,
        message: requestError.message,
        retryable: requestError.retryable,
        details: requestError.details
      }
    }
    if (requestError.includeState && this.identity) {
      body.state = this.getState()
    }
    const encoded = Buffer.from(JSON.stringify(body), 'utf8')
    response.writeHead(requestError.status, {
      'Content-Type': 'application/problem+json; charset=utf-8',
      'Content-Length': encoded.byteLength,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    response.end(encoded)
  }

  private handleDiscoveryError(error: Error): void {
    if (this.discoveryFailure) return
    this.discoveryFailure = error.message
    if (this.status === 'error') return
    this.status = 'degraded'
    this.message = `Secure LAN control is ready, but network discovery failed: ${error.message}`
    this.emitRuntimeState()
  }

  private handleDiscoveryReady(): void {
    if (this.status === 'error' || this.stopping) return
    const recovered = this.discoveryFailure !== null || this.status === 'degraded'
    this.discoveryFailure = null
    if (!recovered) return
    this.status = 'listening'
    this.message = 'Secure LAN control is ready.'
    this.emitRuntimeState()
  }

  private publishDiscovery(identity: LanTlsIdentity): void {
    try {
      this.discovery = this.createDiscovery({
        port: this.port,
        deviceName: this.deviceName,
        identity,
        onError: (error) => this.handleDiscoveryError(error),
        onReady: () => this.handleDiscoveryReady()
      })
    } catch (error) {
      this.handleDiscoveryError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private startNetworkMonitor(): void {
    this.stopNetworkMonitor()
    this.networkMonitor = setInterval(
      () => this.pollNetworkInterfaces(),
      this.networkPollIntervalMs
    )
    this.networkMonitor.unref()
  }

  private stopNetworkMonitor(): void {
    if (!this.networkMonitor) return
    clearInterval(this.networkMonitor)
    this.networkMonitor = null
  }

  private pollNetworkInterfaces(): void {
    if (!this.server || !this.identity || this.stopping || this.status === 'error') return
    const fingerprint = this.getNetworkAddresses().join('|')
    const addressesChanged = fingerprint !== this.networkAddressFingerprint
    if (addressesChanged) {
      this.networkAddressFingerprint = fingerprint
      this.emitRuntimeState()
    }
    if (!addressesChanged && !this.discoveryFailure) return

    const generation = this.lifecycleGeneration
    this.discoveryRefresh = this.discoveryRefresh.then(async () => {
      if (!this.canRefreshDiscovery(generation)) return
      const prior = this.discovery
      this.discovery = null
      try {
        await prior?.stop()
      } catch (error) {
        this.handleDiscoveryError(error instanceof Error ? error : new Error(String(error)))
        return
      }
      if (!this.canRefreshDiscovery(generation)) return
      const identity = this.identity
      if (!identity) return
      this.publishDiscovery(identity)
    })
  }

  private canRefreshDiscovery(generation: number): boolean {
    return (
      generation === this.lifecycleGeneration &&
      this.server !== null &&
      this.identity !== null &&
      !this.stopping &&
      this.status !== 'error'
    )
  }

  private getEndpoints(): string[] {
    if (!this.port) return []
    const addresses = this.getNetworkAddresses()
    if (this.listenHost === '127.0.0.1') addresses.push('127.0.0.1')
    return [...new Set(addresses)]
      .sort((left, right) => left.localeCompare(right))
      .map((address) => `https://${address}:${this.port}`)
  }

  private getNetworkAddresses(): string[] {
    const addresses = new Set<string>()
    for (const entries of Object.values(this.getNetworkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal && isLanAddress(entry.address)) {
          addresses.add(entry.address)
        }
      }
    }
    return [...addresses].sort((left, right) => left.localeCompare(right))
  }

  private emitRuntimeState(): void {
    this.onRuntimeStateChange(this.getRuntimeState())
  }

  private async closeResources(): Promise<void> {
    for (const stream of [...this.eventStreams]) this.closeEventStream(stream)
    const server = this.server
    this.server = null
    const serverClose = server ? closeServer(server) : Promise.resolve()
    const discovery = this.discovery
    this.discovery = null
    if (discovery) {
      try {
        await discovery.stop()
      } catch (error) {
        console.error('LAN discovery could not be stopped.', error)
      }
    }
    await serverClose
  }
}

class BonjourDiscoveryPublisher implements LanDiscoveryPublisher {
  private readonly bonjour: Bonjour
  private readonly service: BonjourService
  private readonly mdns: EventEmitter
  private readonly handleMdnsFailure: (error: unknown) => void
  private readonly publicationTimer: NodeJS.Timeout

  constructor(options: LanDiscoveryOptions) {
    this.handleMdnsFailure = (error) => {
      options.onError(error instanceof Error ? error : new Error(String(error)))
    }
    this.bonjour = new Bonjour(undefined, this.handleMdnsFailure)
    this.mdns = (
      this.bonjour as unknown as {
        server: { mdns: EventEmitter }
      }
    ).server.mdns
    this.mdns.on('error', this.handleMdnsFailure)
    this.mdns.on('warning', this.handleMdnsFailure)
    this.service = this.bonjour.publish({
      name: `Rockfall on ${options.deviceName}`,
      type: 'rockfall',
      protocol: 'tcp',
      port: options.port,
      disableIPv6: true,
      txt: {
        api: String(LAN_PROTOCOL_VERSION),
        serverId: options.identity.serverId,
        pin: options.identity.tlsSpkiSha256
      }
    })
    this.publicationTimer = setTimeout(() => {
      if (!this.service.published) {
        this.handleMdnsFailure(
          new Error('The Rockfall discovery name could not be published on this network.')
        )
      }
    }, 2_000)
    this.publicationTimer.unref()
    this.service.once('up', () => {
      clearTimeout(this.publicationTimer)
      options.onReady()
    })
  }

  async stop(): Promise<void> {
    clearTimeout(this.publicationTimer)
    await new Promise<void>((resolve) => {
      this.service.stop(() => {
        this.bonjour.destroy(() => {
          this.mdns.off('error', this.handleMdnsFailure)
          this.mdns.off('warning', this.handleMdnsFailure)
          resolve()
        })
      })
    })
  }
}

export function isLanAddress(address: string): boolean {
  const normalized = normalizeRemoteAddress(address)
  if (!normalized) return false
  const octets = normalized.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value > 255)) {
    return false
  }
  const [first, second] = octets
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}

function normalizeRemoteAddress(value: string | undefined): string | null {
  if (!value) return null
  return value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value
}

function safeCodeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'ascii')
  const rightBytes = Buffer.from(right, 'ascii')
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
}

function readRequestIdHeader(request: IncomingMessage): string | null {
  const value = request.headers['x-rockfall-request-id']
  return typeof value === 'string' && value.length <= 100 ? value : null
}

function listen(server: HttpsServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error): void => {
      server.off('listening', handleListening)
      reject(error)
    }
    const handleListening = (): void => {
      server.off('error', handleError)
      resolve()
    }
    server.once('error', handleError)
    server.once('listening', handleListening)
    server.listen(port, host)
  })
}

function closeServer(server: HttpsServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
    server.closeAllConnections()
  })
}
