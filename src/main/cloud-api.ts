import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'

import { isLoopbackCloudUrl, normalizeCloudApiUrl } from './cloud-url'

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_OWNERSHIP_SNAPSHOT_BYTES = 768 * 1024 * 1024
const MAX_STATIC_DATA_ARCHIVE_BYTES = 128 * 1024 * 1024
const STATIC_DATA_UPLOAD_TIMEOUT_MS = 10 * 60 * 1_000
const STATIC_DATA_UPLOAD_CHUNK_BYTES = 64 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface CloudAuthenticatedUser {
  id: string
  discordUserId: string
  displayName: string
  avatarHash: string | null
  role: 'user' | 'admin'
}

export interface CloudTokenPair {
  tokenType: 'Bearer'
  accessToken: string
  expiresIn: number
  refreshToken: string
  refreshExpiresAt: string
  user: CloudAuthenticatedUser
}

export interface CloudLoginRequest {
  loginRequestId: string
  authorizeUrl: string
  requestSecret: string
  expiresAt: string
}

export interface CloudProfileIdentity {
  channel: string
  accountId: string
  handle: string | null
}

export interface CloudReceipt {
  normalizedName: string
  name: string
  firstSeenAt: string
  lastSeenAt: string
}

export interface CloudManualBlueprint {
  blueprintId: string
  blueprintKey: string
  owned: boolean
  changedAt: string
}

export interface CloudManualSetPayload extends CloudManualBlueprint {
  blueprintKeyIsUnique: boolean
}

export interface CloudProfileSnapshot extends CloudProfileIdentity {
  profileId: string
  receipts: CloudReceipt[]
  manualBlueprints: CloudManualBlueprint[]
}

export interface CloudOwnershipSnapshot {
  cursor: string
  profiles: CloudProfileSnapshot[]
  serverTime: string
}

export interface CloudReceiptUpsertOperation {
  operationId: string
  kind: 'receipt.upsert'
  profile: CloudProfileIdentity
  receipt: Omit<CloudReceipt, 'normalizedName'>
}

export interface CloudManualSetOperation {
  operationId: string
  kind: 'manual.set'
  profile: CloudProfileIdentity
  manual: CloudManualSetPayload
}

export type CloudSyncOperation = CloudReceiptUpsertOperation | CloudManualSetOperation

export type CloudSyncChange =
  | {
      cursor: string
      kind: 'profile.upsert'
      profile: CloudProfileIdentity
    }
  | {
      cursor: string
      kind: 'receipt.upsert'
      profile: CloudProfileIdentity
      receipt: CloudReceipt
    }
  | {
      cursor: string
      kind: 'manual.set'
      profile: CloudProfileIdentity
      manual: CloudManualBlueprint
    }

export interface CloudOperationRejection {
  operationId: string
  code: string
  detail: string
  retryable: boolean
}

export interface CloudSyncResponse {
  acknowledgedOperationIds: string[]
  rejectedOperations: CloudOperationRejection[]
  changes: CloudSyncChange[]
  nextCursor: string
  hasMore: boolean
  serverTime: string
}

export interface CloudAccountDetails extends CloudAuthenticatedUser {
  createdAt: string
  updatedAt: string
  lastLoginAt: string
}

export interface CloudDeviceDetails {
  id: string
  installationId: string
  name: string
  appVersion: string
  createdAt: string
  lastSeenAt: string
  revokedAt: string | null
  current: boolean
}

export interface CloudAccountIdentityExport {
  id: string
  discordUserId: string
  discordUsername: string
  discordGlobalName: string | null
  discordAvatarHash: string | null
  createdAt: string
  updatedAt: string
  lastLoginAt: string
}

export interface CloudReceiptExport extends CloudReceipt {
  updatedAt: string
}

export interface CloudManualBlueprintExport {
  blueprintId: string
  blueprintKey: string
  owned: boolean
  clientChangedAt: string
  updatedAt: string
}

export interface CloudProfileExport extends CloudProfileIdentity {
  profileId: string
  createdAt: string
  updatedAt: string
  receipts: CloudReceiptExport[]
  manualBlueprints: CloudManualBlueprintExport[]
}

export interface CloudAccountExport {
  account: CloudAccountIdentityExport
  devices: CloudDeviceDetails[]
  profiles: CloudProfileExport[]
  exportedAt: string
}

export interface CloudStaticDataPublishResult {
  status: 'published' | 'alreadyPublished'
  releaseId: string
  contractVersion: 1
  channel: string
  gameBuild: string
  gameVersion: string
  contentSetSha256: string
  publishedAt: string
  current: boolean
  manifestUrl: string
}

export interface CloudStaticDataCapabilities {
  contractVersion: 1
  role: 'user' | 'admin'
  canPublish: boolean
}

export interface CloudStaticDataCurrentRelease {
  releaseId: string
  contractVersion: 1
  channel: string
  gameBuild: string
  gameVersion: string
  contentSetSha256: string
  publishedAt: string
  manifestUrl: string
  source: {
    dataP4kBytes: number
    dataP4kLastWriteAt: string
  }
}

export class CloudApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfterSeconds: number | null

  constructor(
    message: string,
    options: { status: number; code: string; retryAfterSeconds?: number | null }
  ) {
    super(message)
    this.name = 'CloudApiError'
    this.status = options.status
    this.code = options.code
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }
}

export class CloudNetworkError extends Error {
  readonly code: string | null

  constructor(message: string, code: string | null = null) {
    super(message)
    this.name = 'CloudNetworkError'
    this.code = code
  }
}

interface CloudRequestOptions {
  method: 'GET' | 'POST' | 'DELETE'
  accessToken?: string
  body?: unknown
  rawBody?: Buffer
  contentType?: string
  signal?: AbortSignal
  maxResponseBytes?: number
  timeoutMs?: number
  onUploadProgress?: (sentBytes: number, totalBytes: number) => void
}

interface CloudApiClientOptions {
  timeoutMs?: number
}

export class CloudApiClient {
  readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(baseUrl: string, options: CloudApiClientOptions = {}) {
    this.baseUrl = normalizeCloudApiUrl(baseUrl)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  async createLoginRequest(
    input: { installationId: string; deviceName: string; appVersion: string },
    signal?: AbortSignal
  ): Promise<CloudLoginRequest> {
    return parseLoginRequest(
      await this.request('/v1/auth/discord/login-requests', {
        method: 'POST',
        body: input,
        signal
      })
    )
  }

  async exchangeLoginRequest(
    loginRequestId: string,
    input: { requestSecret: string; handoffCode: string },
    signal?: AbortSignal
  ): Promise<CloudTokenPair> {
    assertUuid(loginRequestId, 'Login request ID')
    return parseTokenPair(
      await this.request(
        `/v1/auth/discord/login-requests/${encodeURIComponent(loginRequestId)}/exchange`,
        {
          method: 'POST',
          body: input,
          signal
        }
      )
    )
  }

  async refresh(refreshToken: string, signal?: AbortSignal): Promise<CloudTokenPair> {
    return parseTokenPair(
      await this.request('/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        signal
      })
    )
  }

  async logout(refreshToken: string, signal?: AbortSignal): Promise<void> {
    await this.request('/v1/auth/logout', {
      method: 'POST',
      body: { refreshToken },
      signal
    })
  }

  async logoutAll(accessToken: string, signal?: AbortSignal): Promise<void> {
    await this.request('/v1/auth/logout-all', {
      method: 'POST',
      accessToken,
      signal
    })
  }

  async getAccount(accessToken: string, signal?: AbortSignal): Promise<CloudAccountDetails> {
    return parseAccountDetails(
      await this.request('/v1/account', { method: 'GET', accessToken, signal })
    )
  }

  async getDevices(accessToken: string, signal?: AbortSignal): Promise<CloudDeviceDetails[]> {
    const value = await this.request('/v1/account/devices', {
      method: 'GET',
      accessToken,
      signal
    })
    return readArray(value, 'Device list').map(parseDeviceDetails)
  }

  async revokeDevice(deviceId: string, accessToken: string, signal?: AbortSignal): Promise<void> {
    assertUuid(deviceId, 'Device ID')
    await this.request(`/v1/account/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
      accessToken,
      signal
    })
  }

  async exportAccount(accessToken: string, signal?: AbortSignal): Promise<CloudAccountExport> {
    return parseAccountExport(
      await this.request('/v1/account/export', { method: 'GET', accessToken, signal })
    )
  }

  async deleteAccount(accessToken: string, signal?: AbortSignal): Promise<void> {
    await this.request('/v1/account', { method: 'DELETE', accessToken, signal })
  }

  async getOwnershipSnapshot(
    accessToken: string,
    signal?: AbortSignal
  ): Promise<CloudOwnershipSnapshot> {
    return parseOwnershipSnapshot(
      await this.request('/v1/ownership/snapshot', {
        method: 'GET',
        accessToken,
        signal,
        maxResponseBytes: MAX_OWNERSHIP_SNAPSHOT_BYTES
      })
    )
  }

  async syncOwnership(
    accessToken: string,
    input: { cursor: string; operations: CloudSyncOperation[] },
    signal?: AbortSignal
  ): Promise<CloudSyncResponse> {
    return parseSyncResponse(
      await this.request('/v1/ownership/sync', {
        method: 'POST',
        accessToken,
        body: input,
        signal
      })
    )
  }

  async getStaticDataCapabilities(
    accessToken: string,
    signal?: AbortSignal
  ): Promise<CloudStaticDataCapabilities> {
    return parseStaticDataCapabilities(
      await this.request('/v1/static-data/capabilities', {
        method: 'GET',
        accessToken,
        signal
      })
    )
  }

  async getCurrentStaticDataRelease(
    channel: string,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<CloudStaticDataCurrentRelease> {
    const normalizedChannel = readChannel(channel, 'Static-data channel')
    return parseCurrentStaticDataRelease(
      await this.request(
        `/v1/static-data/channels/${encodeURIComponent(normalizedChannel)}/current`,
        {
          method: 'GET',
          accessToken,
          signal
        }
      )
    )
  }

  async publishStaticDataRelease(
    accessToken: string,
    archive: Buffer,
    onUploadProgress?: (sentBytes: number, totalBytes: number) => void,
    signal?: AbortSignal
  ): Promise<CloudStaticDataPublishResult> {
    if (archive.byteLength === 0 || archive.byteLength > MAX_STATIC_DATA_ARCHIVE_BYTES) {
      throw new RangeError('Static-data release archive size is outside the supported range.')
    }
    return parseStaticDataPublishResult(
      await this.request('/v1/admin/static-data/releases', {
        method: 'POST',
        accessToken,
        rawBody: archive,
        contentType: 'application/zip',
        signal,
        timeoutMs: STATIC_DATA_UPLOAD_TIMEOUT_MS,
        onUploadProgress
      })
    )
  }

  private async request(path: string, options: CloudRequestOptions): Promise<unknown> {
    const url = new URL(path, this.baseUrl)
    if (options.body !== undefined && options.rawBody !== undefined) {
      throw new TypeError('A cloud request cannot have both JSON and raw bodies.')
    }
    const body =
      options.rawBody ??
      (options.body === undefined ? null : Buffer.from(JSON.stringify(options.body)))
    const headers: Record<string, string> = {
      Accept: 'application/json'
    }
    if (body) {
      headers['Content-Type'] = options.contentType ?? 'application/json'
      headers['Content-Length'] = String(body.byteLength)
    }
    if (options.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`
    }

    return new Promise<unknown>((resolve, reject) => {
      const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES
      let settled = false
      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        options.signal?.removeEventListener('abort', abort)
        operation()
      }
      const abort = (): void => {
        request.destroy(new CloudNetworkError('The cloud request was cancelled.', 'ABORT_ERR'))
      }
      const requestFunction = url.protocol === 'https:' ? requestHttps : requestHttp
      const request = requestFunction(
        url,
        {
          method: options.method,
          headers,
          rejectUnauthorized: !isLoopbackCloudUrl(this.baseUrl)
        },
        (response) => {
          const chunks: Buffer[] = []
          let bytes = 0
          let ended = false
          const rejectIncompleteResponse = (reason?: Error): void => {
            finish(() =>
              reject(
                new CloudNetworkError(
                  reason
                    ? `The cloud response was interrupted: ${reason.message}`
                    : 'The cloud response ended before it was complete.',
                  'ECONNRESET'
                )
              )
            )
          }
          response.on('aborted', () => rejectIncompleteResponse())
          response.on('error', rejectIncompleteResponse)
          response.on('close', () => {
            if (!ended && !response.complete) rejectIncompleteResponse()
          })
          response.on('data', (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            bytes += buffer.byteLength
            if (bytes > maxResponseBytes) {
              request.destroy(
                new CloudNetworkError('The cloud response exceeded the supported size.')
              )
              return
            }
            chunks.push(buffer)
          })
          response.on('end', () => {
            ended = true
            const status = response.statusCode ?? 0
            const text = Buffer.concat(chunks).toString('utf8')
            let value: unknown = null
            if (text.trim().length > 0) {
              try {
                value = JSON.parse(text) as unknown
              } catch {
                finish(() =>
                  reject(
                    new CloudApiError('The cloud service returned invalid JSON.', {
                      status,
                      code: 'invalid_response'
                    })
                  )
                )
                return
              }
            }

            if (status < 200 || status >= 300) {
              const problem = parseProblemDetails(value)
              const retryAfter = parseRetryAfter(response.headers['retry-after'])
              finish(() =>
                reject(
                  new CloudApiError(
                    problem.detail ?? problem.title ?? `Cloud request failed with HTTP ${status}.`,
                    {
                      status,
                      code: problem.code ?? 'request_failed',
                      retryAfterSeconds: retryAfter
                    }
                  )
                )
              )
              return
            }
            finish(() => resolve(value))
          })
        }
      )

      request.setTimeout(options.timeoutMs ?? this.timeoutMs, () => {
        request.destroy(new CloudNetworkError('The cloud request timed out.', 'ETIMEDOUT'))
      })
      request.on('error', (reason: Error & { code?: string }) => {
        finish(() => {
          reject(
            reason instanceof CloudNetworkError
              ? reason
              : new CloudNetworkError(
                  `The cloud service could not be reached: ${reason.message}`,
                  reason.code ?? null
                )
          )
        })
      })
      if (options.signal?.aborted) {
        abort()
        return
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      if (body) {
        writeRequestBody(request, body, options.onUploadProgress)
      } else {
        request.end()
      }
    })
  }
}

export function isTransientCloudError(reason: unknown): boolean {
  return (
    reason instanceof CloudNetworkError ||
    (reason instanceof CloudApiError &&
      (reason.status === 408 || reason.status === 429 || reason.status >= 500))
  )
}

function parseLoginRequest(value: unknown): CloudLoginRequest {
  const record = readRecord(value, 'Login request')
  return {
    loginRequestId: readUuid(record.loginRequestId, 'Login request ID'),
    authorizeUrl: readUrl(record.authorizeUrl, 'Authorization URL'),
    requestSecret: readNonEmptyString(record.requestSecret, 'Login request secret', 2_000),
    expiresAt: readTimestamp(record.expiresAt, 'Login request expiry')
  }
}

function parseTokenPair(value: unknown): CloudTokenPair {
  const record = readRecord(value, 'Token response')
  const tokenType = readNonEmptyString(record.tokenType, 'Token type', 50)
  if (tokenType.toLowerCase() !== 'bearer') {
    throw new TypeError('Token response uses an unsupported token type.')
  }
  const expiresInCandidate =
    typeof record.expiresIn === 'string' ? Number(record.expiresIn) : record.expiresIn
  if (
    typeof expiresInCandidate !== 'number' ||
    !Number.isInteger(expiresInCandidate) ||
    expiresInCandidate <= 0
  ) {
    throw new TypeError('Token response has an invalid access-token lifetime.')
  }
  return {
    tokenType: 'Bearer',
    accessToken: readNonEmptyString(record.accessToken, 'Access token', 20_000),
    expiresIn: expiresInCandidate,
    refreshToken: readNonEmptyString(record.refreshToken, 'Refresh token', 20_000),
    refreshExpiresAt: readTimestamp(record.refreshExpiresAt, 'Refresh-token expiry'),
    user: parseAuthenticatedUser(record.user)
  }
}

function parseAuthenticatedUser(value: unknown): CloudAuthenticatedUser {
  const record = readRecord(value, 'Authenticated user')
  const role = readNonEmptyString(record.role, 'User role', 50)
  if (role !== 'user' && role !== 'admin') {
    throw new TypeError('Authenticated user has an unsupported role.')
  }

  return {
    id: readUuid(record.id, 'User ID'),
    discordUserId: readNonEmptyString(record.discordUserId, 'Discord user ID', 100),
    displayName: readNonEmptyString(record.displayName, 'Display name', 200),
    avatarHash: readNullableString(record.avatarHash, 'Avatar hash', 500),
    role
  }
}

function parseStaticDataPublishResult(value: unknown): CloudStaticDataPublishResult {
  const record = readRecord(value, 'Static-data publication result')
  assertExactKeys(
    record,
    [
      'status',
      'releaseId',
      'contractVersion',
      'channel',
      'gameBuild',
      'gameVersion',
      'contentSetSha256',
      'publishedAt',
      'current',
      'manifestUrl'
    ],
    'Static-data publication result'
  )
  const status = readNonEmptyString(record.status, 'Publication status', 50)
  if (status !== 'published' && status !== 'alreadyPublished') {
    throw new TypeError('Static-data publication result has an unsupported status.')
  }

  const contractVersion = readPositiveInteger(record.contractVersion, 'Contract version')
  if (contractVersion !== 1) {
    throw new TypeError('Static-data publication result has an unsupported contract version.')
  }
  const releaseId = readUuid(record.releaseId, 'Published release ID')
  const manifestUrl = readApiPath(record.manifestUrl, 'Published manifest URL')
  if (manifestUrl !== `/v1/static-data/releases/${releaseId}`) {
    throw new TypeError('Published manifest URL does not match the release ID.')
  }
  return {
    status,
    releaseId,
    contractVersion,
    channel: readChannel(record.channel, 'Published channel'),
    gameBuild: readNonEmptyString(record.gameBuild, 'Published game build', 200),
    gameVersion: readNonEmptyString(record.gameVersion, 'Published game version', 200),
    contentSetSha256: readSha256(record.contentSetSha256, 'Published content-set hash'),
    publishedAt: readTimestamp(record.publishedAt, 'Publication time'),
    current: readBoolean(record.current, 'Published release current state'),
    manifestUrl
  }
}

function parseStaticDataCapabilities(value: unknown): CloudStaticDataCapabilities {
  const record = readRecord(value, 'Static-data capabilities')
  assertExactKeys(
    record,
    [
      'contractVersion',
      'role',
      'canPublish',
      'upload',
      'requiredResources',
      'supportedAssetMediaTypes'
    ],
    'Static-data capabilities'
  )
  const contractVersion = readPositiveInteger(record.contractVersion, 'Contract version')
  if (contractVersion !== 1) {
    throw new TypeError('The cloud service does not support static-data contract version 1.')
  }
  const role = readRole(record.role, 'Authoritative user role')
  const canPublish = readBoolean(record.canPublish, 'Static-data publication capability')
  if (canPublish !== (role === 'admin')) {
    throw new TypeError('Static-data publication capability does not match the authoritative role.')
  }

  const upload = readRecord(record.upload, 'Static-data upload capability')
  assertExactKeys(
    upload,
    ['method', 'path', 'mediaType', 'maxArchiveBytes'],
    'Static-data upload capability'
  )
  if (
    upload.method !== 'POST' ||
    upload.path !== '/v1/admin/static-data/releases' ||
    upload.mediaType !== 'application/zip' ||
    readPositiveInteger(upload.maxArchiveBytes, 'Maximum static-data archive bytes') !==
      MAX_STATIC_DATA_ARCHIVE_BYTES
  ) {
    throw new TypeError('The cloud service exposes an incompatible static-data upload contract.')
  }

  const expectedResources = new Map([
    ['signatures', 128],
    ['blueprints', 5_000],
    ['faction-reputation', 500]
  ])
  const requiredResources = readArray(
    record.requiredResources,
    'Required static-data resources'
  )
  if (requiredResources.length !== expectedResources.size) {
    throw new TypeError('The cloud service requires an incompatible static-data resource set.')
  }
  const seenResources = new Set<string>()
  for (const resource of requiredResources) {
    const resourceRecord = readRecord(resource, 'Required static-data resource')
    assertExactKeys(
      resourceRecord,
      ['name', 'schemaVersions', 'maxRecords'],
      'Required static-data resource'
    )
    const name = readNonEmptyString(resourceRecord.name, 'Required resource name', 100)
    const expectedMaxRecords = expectedResources.get(name)
    if (
      expectedMaxRecords === undefined ||
      seenResources.has(name) ||
      !hasExactVersion(resourceRecord.schemaVersions, 1, `Required ${name} schemas`) ||
      readPositiveInteger(resourceRecord.maxRecords, `Maximum ${name} records`) !==
        expectedMaxRecords
    ) {
      throw new TypeError('The cloud service requires an incompatible static-data resource set.')
    }
    seenResources.add(name)
  }

  const mediaTypes = readArray(
    record.supportedAssetMediaTypes,
    'Static-data asset media types'
  )
  if (mediaTypes.length !== 1 || mediaTypes[0] !== 'image/png') {
    throw new TypeError('The cloud service requires incompatible static-data asset types.')
  }
  return {
    contractVersion,
    role,
    canPublish
  }
}

function parseCurrentStaticDataRelease(value: unknown): CloudStaticDataCurrentRelease {
  const record = readRecord(value, 'Current static-data release')
  assertExactKeys(
    record,
    [
      'releaseId',
      'contractVersion',
      'channel',
      'gameBuild',
      'gameVersion',
      'generatedAt',
      'publishedAt',
      'sourceAppVersion',
      'source',
      'contentSetSha256',
      'resources',
      'assets'
    ],
    'Current static-data release'
  )
  const contractVersion = readPositiveInteger(record.contractVersion, 'Contract version')
  if (contractVersion !== 1) {
    throw new TypeError('Current static-data release uses an unsupported contract version.')
  }
  const releaseId = readUuid(record.releaseId, 'Current release ID')
  readTimestamp(record.generatedAt, 'Current release generation time')
  readNonEmptyString(record.sourceAppVersion, 'Current source app version', 100)
  const resources = readArray(record.resources, 'Current static-data resources')
  const seenResources = new Set<string>()
  const resourceNames = resources.map((resource) => {
    const resourceRecord = readRecord(resource, 'Current static-data resource')
    assertExactKeys(
      resourceRecord,
      [
        'name',
        'schemaVersion',
        'mediaType',
        'contentEncoding',
        'sha256',
        'compressedBytes',
        'uncompressedBytes',
        'recordCount',
        'url'
      ],
      'Current static-data resource'
    )
    const schemaVersion = readPositiveInteger(
      resourceRecord.schemaVersion,
      'Resource schema version'
    )
    if (schemaVersion !== 1) {
      throw new TypeError('Current static-data release uses an unsupported resource schema.')
    }
    if (resourceRecord.mediaType !== 'application/json' || resourceRecord.contentEncoding !== 'gzip') {
      throw new TypeError('Current static-data release uses an unsupported resource encoding.')
    }
    readNonNegativeInteger(resourceRecord.recordCount, 'Resource record count')
    readPositiveInteger(resourceRecord.compressedBytes, 'Compressed resource bytes')
    readPositiveInteger(resourceRecord.uncompressedBytes, 'Uncompressed resource bytes')
    readSha256(resourceRecord.sha256, 'Resource hash')
    const name = readNonEmptyString(resourceRecord.name, 'Resource name', 100)
    if (seenResources.has(name)) {
      throw new TypeError('Current static-data release contains a duplicate resource.')
    }
    seenResources.add(name)
    const url = readApiPath(resourceRecord.url, 'Resource URL')
    if (url !== `/v1/static-data/releases/${releaseId}/resources/${name}`) {
      throw new TypeError('Current static-data resource URL does not match its release and name.')
    }
    return name
  })
  const expectedNames = ['blueprints', 'faction-reputation', 'signatures']
  if (
    resourceNames.length !== expectedNames.length ||
    [...resourceNames].sort().some((name, index) => name !== expectedNames[index])
  ) {
    throw new TypeError('Current static-data release has an incompatible resource set.')
  }
  const source = readRecord(record.source, 'Current static-data source')
  assertExactKeys(
    source,
    ['dataP4kBytes', 'dataP4kLastWriteAt'],
    'Current static-data source'
  )
  const seenAssetKeys = new Set<string>()
  for (const asset of readArray(record.assets, 'Current static-data assets')) {
    const assetRecord = readRecord(asset, 'Current static-data asset')
    assertExactKeys(
      assetRecord,
      ['key', 'mediaType', 'sha256', 'byteLength', 'width', 'height', 'url'],
      'Current static-data asset'
    )
    const key = readNonEmptyString(assetRecord.key, 'Static-data asset key', 180)
    const match = /^blueprint-icons\/([0-9a-f]{64})\.png$/.exec(key)
    const hash = readSha256(assetRecord.sha256, 'Static-data asset hash')
    if (!match || match[1] !== hash || seenAssetKeys.has(key)) {
      throw new TypeError('Current static-data release contains an invalid asset key.')
    }
    seenAssetKeys.add(key)
    if (assetRecord.mediaType !== 'image/png') {
      throw new TypeError('Current static-data release uses an unsupported asset media type.')
    }
    readPositiveInteger(assetRecord.byteLength, 'Static-data asset bytes')
    readPositiveInteger(assetRecord.width, 'Static-data asset width')
    readPositiveInteger(assetRecord.height, 'Static-data asset height')
    const url = readApiPath(assetRecord.url, 'Static-data asset URL')
    if (url !== `/v1/static-data/assets/${hash}.png`) {
      throw new TypeError('Current static-data asset URL does not match its content hash.')
    }
  }
  return {
    releaseId,
    contractVersion,
    channel: readChannel(record.channel, 'Current release channel'),
    gameBuild: readNonEmptyString(record.gameBuild, 'Current game build', 200),
    gameVersion: readNonEmptyString(record.gameVersion, 'Current game version', 200),
    contentSetSha256: readSha256(record.contentSetSha256, 'Current content-set hash'),
    publishedAt: readTimestamp(record.publishedAt, 'Current publication time'),
    manifestUrl: `/v1/static-data/releases/${releaseId}`,
    source: {
      dataP4kBytes: readPositiveInteger(source.dataP4kBytes, 'Current source archive bytes'),
      dataP4kLastWriteAt: readTimestamp(
        source.dataP4kLastWriteAt,
        'Current source archive modification time'
      )
    }
  }
}

function parseOwnershipSnapshot(value: unknown): CloudOwnershipSnapshot {
  const record = readRecord(value, 'Ownership snapshot')
  return {
    cursor: readString(record.cursor, 'Ownership cursor', 100),
    profiles: readArray(record.profiles, 'Ownership profiles').map(parseProfileSnapshot),
    serverTime: readTimestamp(record.serverTime, 'Ownership server time')
  }
}

function parseProfileSnapshot(value: unknown): CloudProfileSnapshot {
  const record = readRecord(value, 'Ownership profile')
  return {
    profileId: readUuid(record.profileId, 'Profile ID'),
    ...parseProfileIdentity(record),
    receipts: readArray(record.receipts, 'Profile receipts').map(parseReceipt),
    manualBlueprints: readArray(record.manualBlueprints, 'Profile manual states').map(
      parseManualBlueprint
    )
  }
}

function parseProfileIdentity(value: unknown): CloudProfileIdentity {
  const record = readRecord(value, 'Profile identity')
  return {
    channel: readNonEmptyString(record.channel, 'Profile channel', 32),
    accountId: readNonEmptyString(record.accountId, 'Profile account ID', 100),
    handle: readNullableString(record.handle, 'Profile handle', 200)
  }
}

function parseReceipt(value: unknown): CloudReceipt {
  const record = readRecord(value, 'Blueprint receipt')
  return {
    normalizedName: readNonEmptyString(record.normalizedName, 'Normalized receipt name', 500),
    name: readNonEmptyString(record.name, 'Receipt name', 500),
    firstSeenAt: readTimestamp(record.firstSeenAt, 'Receipt first-seen time'),
    lastSeenAt: readTimestamp(record.lastSeenAt, 'Receipt last-seen time')
  }
}

function parseManualBlueprint(value: unknown): CloudManualBlueprint {
  const record = readRecord(value, 'Manual blueprint state')
  return {
    blueprintId: readNonEmptyString(record.blueprintId, 'Blueprint ID', 200),
    blueprintKey: readNonEmptyString(record.blueprintKey, 'Blueprint key', 500),
    owned: readBoolean(record.owned, 'Manual ownership state'),
    changedAt: readTimestamp(record.changedAt, 'Manual ownership change time')
  }
}

function parseSyncResponse(value: unknown): CloudSyncResponse {
  const record = readRecord(value, 'Sync response')
  return {
    acknowledgedOperationIds: readArray(
      record.acknowledgedOperationIds,
      'Acknowledged operations'
    ).map((operationId) => readUuid(operationId, 'Acknowledged operation ID')),
    rejectedOperations: readArray(record.rejectedOperations, 'Rejected operations').map(
      parseOperationRejection
    ),
    changes: readArray(record.changes, 'Sync changes').map(parseSyncChange),
    nextCursor: readString(record.nextCursor, 'Next sync cursor', 100),
    hasMore: readBoolean(record.hasMore, 'Sync continuation state'),
    serverTime: readTimestamp(record.serverTime, 'Sync server time')
  }
}

function parseOperationRejection(value: unknown): CloudOperationRejection {
  const record = readRecord(value, 'Operation rejection')
  return {
    operationId: readUuid(record.operationId, 'Rejected operation ID'),
    code: readNonEmptyString(record.code, 'Operation rejection code', 200),
    detail: readNonEmptyString(record.detail, 'Operation rejection detail', 2_000),
    retryable:
      record.retryable === undefined
        ? false
        : readBoolean(record.retryable, 'Operation retryable state')
  }
}

function parseSyncChange(value: unknown): CloudSyncChange {
  const record = readRecord(value, 'Sync change')
  const cursor = readString(record.cursor, 'Change cursor', 100)
  const kind = readNonEmptyString(record.kind, 'Change kind', 50)
  const profile = parseProfileIdentity(record.profile)
  if (kind === 'profile.upsert') {
    return { cursor, kind, profile }
  }
  if (kind === 'receipt.upsert') {
    return {
      cursor,
      kind,
      profile,
      receipt: parseReceipt(record.receipt)
    }
  }
  if (kind === 'manual.set') {
    return {
      cursor,
      kind,
      profile,
      manual: parseManualBlueprint(record.manual)
    }
  }
  throw new TypeError(`Sync response contains unsupported change kind "${kind}".`)
}

function parseAccountDetails(value: unknown): CloudAccountDetails {
  const record = readRecord(value, 'Account')
  return {
    ...parseAuthenticatedUser(record),
    createdAt: readTimestamp(record.createdAt, 'Account creation time'),
    updatedAt: readTimestamp(record.updatedAt, 'Account update time'),
    lastLoginAt: readTimestamp(record.lastLoginAt, 'Account last-login time')
  }
}

function parseDeviceDetails(value: unknown): CloudDeviceDetails {
  const record = readRecord(value, 'Device')
  return {
    id: readUuid(record.id, 'Device ID'),
    installationId: readUuid(record.installationId, 'Installation ID'),
    name: readNonEmptyString(record.name, 'Device name', 200),
    appVersion: readNonEmptyString(record.appVersion, 'Device app version', 32),
    createdAt: readTimestamp(record.createdAt, 'Device creation time'),
    lastSeenAt: readTimestamp(record.lastSeenAt, 'Device last-seen time'),
    revokedAt:
      record.revokedAt === null ? null : readTimestamp(record.revokedAt, 'Device revocation time'),
    current: readBoolean(record.current, 'Current-device state')
  }
}

function parseAccountExport(value: unknown): CloudAccountExport {
  const record = readRecord(value, 'Account export')
  return {
    account: parseAccountIdentityExport(record.account),
    devices: readArray(record.devices, 'Exported devices').map(parseDeviceDetails),
    profiles: readArray(record.profiles, 'Exported profiles').map(parseProfileExport),
    exportedAt: readTimestamp(record.exportedAt, 'Account export time')
  }
}

function parseAccountIdentityExport(value: unknown): CloudAccountIdentityExport {
  const record = readRecord(value, 'Exported account')
  return {
    id: readUuid(record.id, 'Exported account ID'),
    discordUserId: readNonEmptyString(record.discordUserId, 'Exported Discord user ID', 100),
    discordUsername: readNonEmptyString(record.discordUsername, 'Exported Discord username', 200),
    discordGlobalName: readNullableString(
      record.discordGlobalName,
      'Exported Discord global name',
      200
    ),
    discordAvatarHash: readNullableString(
      record.discordAvatarHash,
      'Exported Discord avatar hash',
      500
    ),
    createdAt: readTimestamp(record.createdAt, 'Exported account creation time'),
    updatedAt: readTimestamp(record.updatedAt, 'Exported account update time'),
    lastLoginAt: readTimestamp(record.lastLoginAt, 'Exported account last-login time')
  }
}

function parseProfileExport(value: unknown): CloudProfileExport {
  const record = readRecord(value, 'Exported profile')
  return {
    profileId: readUuid(record.profileId, 'Exported profile ID'),
    ...parseProfileIdentity(record),
    createdAt: readTimestamp(record.createdAt, 'Exported profile creation time'),
    updatedAt: readTimestamp(record.updatedAt, 'Exported profile update time'),
    receipts: readArray(record.receipts, 'Exported receipts').map((receipt) => {
      const parsed = parseReceipt(receipt)
      const receiptRecord = readRecord(receipt, 'Exported receipt')
      return {
        ...parsed,
        updatedAt: readTimestamp(receiptRecord.updatedAt, 'Exported receipt update time')
      }
    }),
    manualBlueprints: readArray(record.manualBlueprints, 'Exported manual states').map((manual) => {
      const manualRecord = readRecord(manual, 'Exported manual state')
      return {
        blueprintId: readNonEmptyString(manualRecord.blueprintId, 'Exported blueprint ID', 200),
        blueprintKey: readNonEmptyString(manualRecord.blueprintKey, 'Exported blueprint key', 500),
        owned: readBoolean(manualRecord.owned, 'Exported manual ownership state'),
        clientChangedAt: readTimestamp(
          manualRecord.clientChangedAt,
          'Exported manual client-change time'
        ),
        updatedAt: readTimestamp(manualRecord.updatedAt, 'Exported manual update time')
      }
    })
  }
}

function parseProblemDetails(value: unknown): {
  title: string | null
  detail: string | null
  code: string | null
} {
  if (!isRecord(value)) return { title: null, detail: null, code: null }
  return {
    title: typeof value.title === 'string' ? value.title : null,
    detail: typeof value.detail === 'string' ? value.detail : null,
    code: typeof value.code === 'string' ? value.code : null
  }
}

function parseRetryAfter(value: string | string[] | undefined): number | null {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!candidate) return null
  const seconds = Number(candidate)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`)
  return value
}

function assertExactKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string
): void {
  const actual = Object.keys(record).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly the documented fields.`)
  }
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`)
  return value
}

function readString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new TypeError(`${label} must be a string no longer than ${maxLength} characters.`)
  }
  return value
}

function readNonEmptyString(value: unknown, label: string, maxLength: number): string {
  const candidate = readString(value, label, maxLength)
  if (candidate.trim().length === 0) throw new TypeError(`${label} cannot be empty.`)
  return candidate
}

function readNullableString(value: unknown, label: string, maxLength: number): string | null {
  return value === null ? null : readString(value, label, maxLength)
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`)
  return value
}

function readRole(value: unknown, label: string): 'user' | 'admin' {
  const role = readNonEmptyString(value, label, 50)
  if (role !== 'user' && role !== 'admin') {
    throw new TypeError(`${label} must be "user" or "admin".`)
  }
  return role
}

function readChannel(value: unknown, label: string): string {
  const channel = readNonEmptyString(value, label, 32)
  if (!/^[A-Za-z0-9_-]+$/.test(channel)) {
    throw new TypeError(`${label} contains unsupported characters.`)
  }
  return channel
}

function hasExactVersion(value: unknown, version: number, label: string): boolean {
  const versions = readArray(value, label)
  return versions.length === 1 && versions[0] === version
}

function readPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`)
  }
  return value
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`)
  }
  return value
}

function readSha256(value: unknown, label: string): string {
  const candidate = readNonEmptyString(value, label, 64)
  if (!/^[0-9a-f]{64}$/.test(candidate)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hash.`)
  }
  return candidate
}

function readApiPath(value: unknown, label: string): string {
  const candidate = readNonEmptyString(value, label, 2_048)
  if (!candidate.startsWith('/v1/') || candidate.includes('\\')) {
    throw new TypeError(`${label} must be a versioned API path.`)
  }
  return candidate
}

function readTimestamp(value: unknown, label: string): string {
  const candidate = readNonEmptyString(value, label, 100)
  if (!Number.isFinite(Date.parse(candidate))) throw new TypeError(`${label} must be a timestamp.`)
  return candidate
}

function readUuid(value: unknown, label: string): string {
  const candidate = readNonEmptyString(value, label, 100)
  assertUuid(candidate, label)
  return candidate
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new TypeError(`${label} must be a UUID.`)
}

function writeRequestBody(
  request: import('node:http').ClientRequest,
  body: Buffer,
  onProgress?: (sentBytes: number, totalBytes: number) => void
): void {
  let offset = 0
  onProgress?.(0, body.byteLength)

  const writeNext = (): void => {
    if (request.destroyed) return
    if (offset >= body.byteLength) {
      request.end()
      return
    }
    const end = Math.min(offset + STATIC_DATA_UPLOAD_CHUNK_BYTES, body.byteLength)
    request.write(body.subarray(offset, end), () => {
      offset = end
      onProgress?.(offset, body.byteLength)
      writeNext()
    })
  }

  writeNext()
}

function readUrl(value: unknown, label: string): string {
  const candidate = readNonEmptyString(value, label, 2_048)
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new TypeError(`${label} must be an absolute URL.`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackCloudUrl(url.origin))) {
    throw new TypeError(`${label} must use HTTPS.`)
  }
  return url.toString()
}
