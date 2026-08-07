import type {
  CloudSyncState,
  CloudSyncStatus,
  CloudUserSummary,
  StaticDataPublicationResult,
  StaticDataReleaseSummary
} from '../shared/contracts'
import {
  CloudApiClient,
  CloudApiError,
  CloudNetworkError,
  type CloudAuthenticatedUser,
  type CloudBlueprintMarker,
  type CloudStaticDataCurrentRelease,
  type CloudStaticDataPublishResult,
  type CloudSyncOperation,
  type CloudTokenPair,
  isTransientCloudError
} from './cloud-api'
import type {
  CloudOwnershipLayer,
  OwnershipProfileIdentity,
  OwnershipSyncProfile
} from './blueprint-ownership'
import {
  applyCloudSyncResponse,
  captureLocalProfiles,
  cloneCloudState,
  enqueueManualOperation,
  getCloudOwnershipLayer,
  getCloudOwnershipProfileIdentity,
  getOrCreateNamespace,
  loadCloudState,
  replaceCloudSnapshot,
  saveCloudState,
  type CloudStateData
} from './cloud-state'
import { normalizeCloudApiUrl } from './cloud-url'

const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60_000
const MAX_SYNC_BATCH = 500
const MAX_SYNC_REQUEST_BYTES = 1024 * 1024
const MAX_SYNC_PAGES = 1_000
const DEFAULT_MAX_PENDING_OPERATIONS = 10_000
const MAX_RETRY_ATTEMPTS = 3
const RETRY_DELAYS_MS = [250, 1_000, 4_000]

type CloudClient = Pick<
  CloudApiClient,
  | 'createLoginRequest'
  | 'exchangeLoginRequest'
  | 'refresh'
  | 'logout'
  | 'getOwnershipSnapshot'
  | 'syncOwnership'
  | 'getStaticDataCapabilities'
  | 'getCurrentStaticDataRelease'
  | 'getStaticDataBlueprintMarkers'
  | 'publishStaticDataRelease'
>

export interface RefreshTokenProtector {
  isEncryptionAvailable: () => boolean
  encrypt: (value: string) => string
  decrypt: (value: string) => string
}

export interface CloudSyncControllerOptions {
  storePath: string
  apiUrl: string
  appVersion: string
  deviceName: string
  tokenProtector: RefreshTokenProtector
  getLocalProfiles: () => OwnershipSyncProfile[]
  prepareLocalProfiles?: () => Promise<void>
  isBlueprintKeyUnique?: (blueprintKey: string) => boolean
  getActiveProfile: () => {
    channel: string
    accountId: string | null
    handle: string | null
  } | null
  openExternal: (url: string) => Promise<void>
  onStateChange: (state: CloudSyncState) => void
  onOwnershipChange: () => void
  apiFactory?: (apiUrl: string) => CloudClient
  now?: () => Date
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  syncIntervalMs?: number
  maxPendingOperations?: number
}

interface PendingCloudLogin {
  loginRequestId: string
  requestSecret: string
  expiresAt: string
}

class CloudAuthenticationExpiredError extends Error {}

export interface CloudLoginCallback {
  loginRequestId: string
  handoffCode: string
}

export interface StaticDataOverview {
  canPublish: boolean
  currentRelease: StaticDataReleaseSummary | null
  source: CloudStaticDataCurrentRelease['source'] | null
}

export class CloudSyncController {
  private readonly storePath: string
  private readonly appVersion: string
  private readonly deviceName: string
  private readonly tokenProtector: RefreshTokenProtector
  private readonly getLocalProfiles: () => OwnershipSyncProfile[]
  private readonly prepareLocalProfiles: () => Promise<void>
  private readonly isBlueprintKeyUnique: (blueprintKey: string) => boolean
  private readonly getActiveProfile: CloudSyncControllerOptions['getActiveProfile']
  private readonly openExternal: (url: string) => Promise<void>
  private readonly onStateChange: (state: CloudSyncState) => void
  private readonly onOwnershipChange: () => void
  private readonly apiFactory: (apiUrl: string) => CloudClient
  private readonly now: () => Date
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  private readonly syncIntervalMs: number
  private readonly maxPendingOperations: number
  private apiUrl: string
  private api: CloudClient
  private state: CloudStateData
  private stateWarning: string | null = null
  private status: CloudSyncStatus = 'signed-out'
  private message = 'Sign in with Discord to synchronize blueprint ownership.'
  private blockedProfileKeys: string[] = []
  private pendingLogin: PendingCloudLogin | null = null
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0
  private refreshToken: string | null = null
  private operationQueue: Promise<void> = Promise.resolve()
  private syncTimer: NodeJS.Timeout | null = null
  private abortController = new AbortController()
  private disposed = false

  constructor(options: CloudSyncControllerOptions) {
    this.storePath = options.storePath
    this.apiUrl = normalizeCloudApiUrl(options.apiUrl)
    this.appVersion = options.appVersion
    this.deviceName = options.deviceName
    this.tokenProtector = options.tokenProtector
    this.getLocalProfiles = options.getLocalProfiles
    this.prepareLocalProfiles = options.prepareLocalProfiles ?? (() => Promise.resolve())
    this.isBlueprintKeyUnique = options.isBlueprintKeyUnique ?? (() => false)
    this.getActiveProfile = options.getActiveProfile
    this.openExternal = options.openExternal
    this.onStateChange = options.onStateChange
    this.onOwnershipChange = options.onOwnershipChange
    this.apiFactory = options.apiFactory ?? ((apiUrl) => new CloudApiClient(apiUrl))
    this.api = this.apiFactory(this.apiUrl)
    this.now = options.now ?? (() => new Date())
    this.sleep = options.sleep ?? abortableSleep
    this.syncIntervalMs = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS
    this.maxPendingOperations = Math.max(
      1,
      Math.min(
        options.maxPendingOperations ?? DEFAULT_MAX_PENDING_OPERATIONS,
        DEFAULT_MAX_PENDING_OPERATIONS
      )
    )
    this.state = {
      schemaVersion: 1,
      installationId: '00000000-0000-4000-8000-000000000000',
      lastUserId: null,
      session: null,
      namespaces: {},
      profileAssociations: {}
    }
  }

  async initialize(): Promise<void> {
    const loaded = await loadCloudState(this.storePath)
    this.state = loaded.state
    this.stateWarning = loaded.warning
    if (loaded.needsSave) await saveCloudState(this.storePath, this.state)

    const session = this.state.session
    if (!session || session.apiUrl !== this.apiUrl) {
      if (session?.apiUrl !== this.apiUrl) {
        await this.clearSession(
          'The cloud API endpoint changed. Sign in again for the selected service.'
        )
      } else {
        this.setRuntimeState(
          'signed-out',
          this.stateWarning ?? 'Sign in with Discord to synchronize blueprint ownership.'
        )
      }
      this.startTimer()
      return
    }

    if (!session.encryptedRefreshToken) {
      await this.clearSession(
        'The previous sign-in was kept in memory only. Sign in again after restarting Rockfall.'
      )
      this.startTimer()
      return
    }
    if (!this.tokenProtector.isEncryptionAvailable()) {
      await this.clearSession(
        'Windows credential encryption is unavailable, so the saved cloud session cannot be opened.'
      )
      this.startTimer()
      return
    }

    try {
      this.refreshToken = this.tokenProtector.decrypt(session.encryptedRefreshToken)
    } catch (error) {
      await this.clearSession(
        `The saved cloud session could not be decrypted: ${getErrorMessage(error)}`
      )
      this.startTimer()
      return
    }
    if (Date.parse(session.refreshExpiresAt) <= this.now().getTime()) {
      await this.clearSession('The saved Discord sign-in expired. Sign in again to resume syncing.')
      this.startTimer()
      return
    }

    this.setRuntimeState('restoring', `Restoring ${session.user.displayName}'s cloud session…`)
    this.startTimer()
    void this.syncNow()
  }

  getSnapshot(): CloudSyncState {
    const userId = this.state.session?.user.id ?? this.state.lastUserId
    const namespace = userId ? this.state.namespaces[userId] : null
    return {
      status: this.status,
      user: this.state.session ? sanitizeUser(this.state.session.user) : null,
      message: this.message,
      lastSyncedAt: namespace?.lastSyncedAt ?? null,
      pendingOperationCount: namespace?.pendingOperations.length ?? 0,
      quarantinedOperationCount: namespace?.quarantinedOperations.length ?? 0,
      blockedProfileCount: this.blockedProfileKeys.length,
      loginExpiresAt: this.pendingLogin?.expiresAt ?? null,
      refreshTokenPersistent: Boolean(this.state.session?.encryptedRefreshToken)
    }
  }

  getOwnershipLayer(): CloudOwnershipLayer | null {
    return getCloudOwnershipLayer(this.state, this.getActiveProfile())
  }

  beginLogin(): Promise<CloudSyncState> {
    return this.enqueue(async () => {
      this.pendingLogin = null
      this.setRuntimeState('connecting', 'Creating a secure Discord sign-in request…')
      try {
        const login = await this.withRetry((signal) =>
          this.api.createLoginRequest(
            {
              installationId: this.state.installationId,
              deviceName: this.deviceName,
              appVersion: this.appVersion
            },
            signal
          )
        )
        if (new URL(login.authorizeUrl).origin !== new URL(this.apiUrl).origin) {
          throw new Error('The cloud service returned an authorization URL for another origin.')
        }
        this.pendingLogin = {
          loginRequestId: login.loginRequestId,
          requestSecret: login.requestSecret,
          expiresAt: login.expiresAt
        }
        this.setRuntimeState(
          'waiting-for-browser',
          'Finish authorization in Discord, then return to Rockfall.'
        )
        await this.openExternal(login.authorizeUrl)
        return this.getSnapshot()
      } catch (error) {
        this.setRuntimeState('error', `Discord sign-in could not start: ${getErrorMessage(error)}`)
        throw error
      }
    })
  }

  completeLogin(callback: CloudLoginCallback): Promise<CloudSyncState> {
    return this.enqueue(async () => {
      const pending = this.pendingLogin
      if (!pending || callback.loginRequestId !== pending.loginRequestId) {
        throw new Error('This Discord callback does not match the active Rockfall sign-in.')
      }
      if (Date.parse(pending.expiresAt) <= this.now().getTime()) {
        this.pendingLogin = null
        this.setRuntimeState('error', 'The Discord sign-in request expired. Start a new sign-in.')
        throw new Error('The Discord sign-in request expired.')
      }
      if (
        typeof callback.handoffCode !== 'string' ||
        callback.handoffCode.trim().length === 0 ||
        callback.handoffCode.length > 2_000
      ) {
        throw new TypeError('A valid Discord handoff code is required.')
      }

      this.setRuntimeState('restoring', 'Securing the cloud session and restoring ownership…')
      try {
        const tokens = await this.withRetry((signal) =>
          this.api.exchangeLoginRequest(
            pending.loginRequestId,
            {
              requestSecret: pending.requestSecret,
              handoffCode: callback.handoffCode.trim()
            },
            signal
          )
        )
        this.pendingLogin = null
        await this.acceptTokenPair(tokens)
        await this.restoreSnapshot()
        await this.performSync()
        return this.getSnapshot()
      } catch (error) {
        this.setRuntimeState('error', `Discord sign-in could not finish: ${getErrorMessage(error)}`)
        throw error
      }
    })
  }

  completeLoginCode(handoffCode: string): Promise<CloudSyncState> {
    const pending = this.pendingLogin
    if (!pending) return Promise.reject(new Error('No Discord sign-in is waiting for a code.'))
    return this.completeLogin({ loginRequestId: pending.loginRequestId, handoffCode })
  }

  cancelLogin(): Promise<CloudSyncState> {
    return this.enqueue(async () => {
      this.pendingLogin = null
      this.setRuntimeState(
        this.state.session ? 'synced' : 'signed-out',
        this.state.session
          ? `Signed in as ${this.state.session.user.displayName}.`
          : 'Discord sign-in was cancelled.'
      )
      return this.getSnapshot()
    })
  }

  syncNow(): Promise<CloudSyncState> {
    return this.enqueue(async () => {
      await this.performSync()
      return this.getSnapshot()
    })
  }

  getStaticDataOverview(channel: string): Promise<StaticDataOverview> {
    return this.enqueue(async () => {
      if (!this.state.session) throw new Error('Sign in before checking static data.')
      try {
        const capabilities = await this.withAuthenticatedRetry((accessToken, signal) =>
          this.api.getStaticDataCapabilities(accessToken, signal)
        )
        await this.applyAuthoritativeRole(capabilities.role)
        let current: CloudStaticDataCurrentRelease | null = null
        try {
          current = await this.withAuthenticatedRetry((accessToken, signal) =>
            this.api.getCurrentStaticDataRelease(channel, accessToken, signal)
          )
        } catch (error) {
          if (
            !(error instanceof CloudApiError) ||
            error.status !== 404 ||
            error.code !== 'static_data_not_published'
          ) {
            throw error
          }
        }
        return {
          canPublish: capabilities.role === 'admin' && capabilities.canPublish,
          currentRelease: current
            ? {
                releaseId: current.releaseId,
                contractVersion: current.contractVersion,
                channel: current.channel,
                gameBuild: current.gameBuild,
                gameVersion: current.gameVersion,
                contentSetSha256: current.contentSetSha256,
                publishedAt: current.publishedAt,
                current: true,
                manifestUrl: current.manifestUrl
              }
            : null,
          source: current?.source ?? null
        }
      } catch (error) {
        if (isAuthenticationError(error)) {
          await this.clearSession('Cloud authentication expired. Sign in again to publish data.')
          this.status = 'auth-expired'
          this.emitState()
        }
        throw error
      }
    })
  }

  getBlueprintNewMarkers(
    channel: string
  ): Promise<{ release: CloudStaticDataCurrentRelease; markers: CloudBlueprintMarker[] }> {
    return this.enqueue(async () => {
      if (!this.state.session) throw new Error('Sign in before loading blueprint markers.')
      const release = await this.withAuthenticatedRetry((accessToken, signal) =>
        this.api.getCurrentStaticDataRelease(channel, accessToken, signal)
      )
      const markers = await this.withAuthenticatedRetry((accessToken, signal) =>
        this.api.getStaticDataBlueprintMarkers(release.resources.blueprints, accessToken, signal)
      )
      return { release, markers }
    })
  }

  publishStaticDataRelease(
    archive: Buffer,
    onUploadProgress?: (sentBytes: number, totalBytes: number) => void
  ): Promise<StaticDataPublicationResult> {
    return this.enqueue(async () => {
      const session = this.state.session
      if (!session) throw new Error('Sign in before publishing static data.')
      if (session.user.role !== 'admin') {
        throw new CloudApiError('An administrator role is required to publish static data.', {
          status: 403,
          code: 'static_data_admin_required'
        })
      }
      try {
        const result = await this.withAuthenticatedRetry((accessToken, signal) =>
          this.api.publishStaticDataRelease(accessToken, archive, onUploadProgress, signal)
        )
        return toStaticDataPublishResult(result)
      } catch (error) {
        if (error instanceof CloudApiError && error.status === 403) {
          try {
            const capabilities = await this.withAuthenticatedRetry((accessToken, signal) =>
              this.api.getStaticDataCapabilities(accessToken, signal)
            )
            await this.applyAuthoritativeRole(capabilities.role)
          } catch (refreshError) {
            if (isAuthenticationError(refreshError)) {
              await this.clearSession(
                'Cloud authentication expired. Sign in again to publish data.'
              )
              this.status = 'auth-expired'
              this.emitState()
            }
            throw refreshError
          }
        }
        if (isAuthenticationError(error)) {
          await this.clearSession('Cloud authentication expired. Sign in again to publish data.')
          this.status = 'auth-expired'
          this.emitState()
        }
        throw error
      }
    })
  }

  captureLocalChanges(): Promise<CloudSyncState> {
    return this.enqueue(async () => {
      await this.captureProfiles(false)
      if (this.state.session) await this.performSync()
      return this.getSnapshot()
    })
  }

  recordManualChange(
    profile: OwnershipProfileIdentity,
    manual: {
      blueprintId: string
      blueprintKey: string
      owned: boolean
      changedAt?: string
      keyIsUnique?: boolean
    }
  ): Promise<CloudSyncState> {
    return this.enqueue(async () => {
      const session = this.state.session
      const next = cloneCloudState(this.state)
      const fallbackProfile = getCloudOwnershipProfileIdentity(next, this.getActiveProfile())
      const targetProfile = /^[0-9]{1,100}$/.test(profile.accountId)
        ? profile
        : (fallbackProfile ?? profile)
      const targetUserId = session?.user.id ?? (fallbackProfile ? next.lastUserId : null)
      const result = enqueueManualOperation(
        next,
        targetUserId,
        targetProfile,
        {
          blueprintId: manual.blueprintId,
          blueprintKey: manual.blueprintKey,
          owned: manual.owned,
          changedAt: manual.changedAt ?? this.now().toISOString()
        },
        manual.keyIsUnique === true
      )
      if (result.blockedProfileKey) {
        this.blockedProfileKeys = [
          ...new Set([...this.blockedProfileKeys, result.blockedProfileKey])
        ]
      }
      if (!result.queued) {
        this.emitState()
        return this.getSnapshot()
      }
      await this.commit(next)
      this.onOwnershipChange()
      return this.getSnapshot()
    })
  }

  confirmProfileImport(): Promise<CloudSyncState> {
    return this.enqueue(async () => {
      if (!this.state.session) throw new Error('Sign in before importing local ownership.')
      await this.performSync(true)
      return this.getSnapshot()
    })
  }

  changeApiUrl(apiUrl: string): Promise<CloudSyncState> {
    return this.enqueue(async () => {
      const normalized = normalizeCloudApiUrl(apiUrl)
      if (normalized === this.apiUrl) return this.getSnapshot()
      this.apiUrl = normalized
      this.api = this.apiFactory(normalized)
      this.pendingLogin = null
      this.accessToken = null
      this.accessTokenExpiresAt = 0
      this.refreshToken = null
      const next = cloneCloudState(this.state)
      next.session = null
      await this.commit(next)
      this.setRuntimeState(
        'signed-out',
        'Cloud API endpoint changed. Sign in to connect this installation.'
      )
      return this.getSnapshot()
    })
  }

  logout(): Promise<CloudSyncState> {
    return this.enqueue(async () => {
      const refreshToken = this.refreshToken
      let remoteError: string | null = null
      if (refreshToken) {
        try {
          await this.withRetry((signal) => this.api.logout(refreshToken, signal))
        } catch (error) {
          remoteError = getErrorMessage(error)
        }
      }
      await this.clearSession(
        remoteError
          ? `Signed out locally, but the server session could not be revoked: ${remoteError}`
          : 'Signed out. Cached ownership remains available on this PC.'
      )
      return this.getSnapshot()
    })
  }

  handleLoginUrl(value: string): Promise<CloudSyncState> {
    const callback = parseCloudLoginUrl(value)
    return this.completeLogin(callback)
  }

  dispose(): void {
    this.disposed = true
    this.abortController.abort()
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.syncTimer = null
    this.pendingLogin = null
    this.accessToken = null
    this.refreshToken = null
  }

  private async performSync(allowReassociation = false): Promise<void> {
    const session = this.state.session
    if (!session || !this.refreshToken) {
      this.setRuntimeState(
        'signed-out',
        this.message || 'Sign in with Discord to synchronize blueprint ownership.'
      )
      return
    }
    this.setRuntimeState('syncing', 'Synchronizing blueprint ownership…')

    try {
      await this.ensureAccessToken()
      await this.prepareLocalProfiles()
      const namespace = getOrCreateNamespace(this.state, session.user.id)
      if (!namespace.hasSnapshot) await this.restoreSnapshot()
      let localCaptureHasMore = await this.captureProfiles(allowReassociation)

      for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
        const currentNamespace = getOrCreateNamespace(this.state, session.user.id)
        const operations = selectSyncOperations(
          currentNamespace.cursor,
          currentNamespace.pendingOperations
        )
        const attemptedIds = new Set(operations.map((operation) => operation.operationId))
        const response = await this.withAuthenticatedRetry((accessToken, signal) =>
          this.api.syncOwnership(
            accessToken,
            { cursor: currentNamespace.cursor, operations },
            signal
          )
        )
        const next = cloneCloudState(this.state)
        const nextNamespace = getOrCreateNamespace(next, session.user.id)
        const previousPendingCount = nextNamespace.pendingOperations.length
        applyCloudSyncResponse(
          nextNamespace,
          response,
          attemptedIds,
          this.now().toISOString(),
          this.isBlueprintKeyUnique
        )
        await this.commit(next)
        this.onOwnershipChange()

        const madeProgress =
          nextNamespace.pendingOperations.length < previousPendingCount ||
          response.changes.length > 0 ||
          response.nextCursor !== currentNamespace.cursor
        if (!response.hasMore && nextNamespace.pendingOperations.length === 0) {
          if (localCaptureHasMore) {
            localCaptureHasMore = await this.captureProfiles(allowReassociation)
            const recapturedNamespace = getOrCreateNamespace(this.state, session.user.id)
            if (recapturedNamespace.pendingOperations.length > 0) continue
          }
          break
        }
        if (!madeProgress) {
          throw new Error(
            'The cloud service made no progress while synchronization remained pending.'
          )
        }
        if (page === MAX_SYNC_PAGES - 1) {
          throw new Error('Cloud synchronization exceeded the supported continuation limit.')
        }
      }

      const syncedNamespace = getOrCreateNamespace(this.state, session.user.id)
      const quarantineCount = syncedNamespace.quarantinedOperations.length
      const blockedCount = this.blockedProfileKeys.length
      const persistenceNotice = this.state.session?.encryptedRefreshToken
        ? null
        : ' Sign-in will not survive an app restart because the refresh token could not be protected and saved.'
      this.setRuntimeState(
        'synced',
        [
          `Synced as ${session.user.displayName}.`,
          blockedCount > 0
            ? `${blockedCount} local profile${blockedCount === 1 ? '' : 's'} require import confirmation.`
            : null,
          quarantineCount > 0
            ? `${quarantineCount} rejected operation${quarantineCount === 1 ? '' : 's'} were quarantined.`
            : null,
          persistenceNotice,
          this.stateWarning
        ]
          .filter(Boolean)
          .join(' ')
      )
    } catch (error) {
      if (isAuthenticationError(error)) {
        await this.clearSession('Cloud authentication expired. Sign in again to resume syncing.')
        this.status = 'auth-expired'
        this.emitState()
        return
      }
      const pendingCount = this.state.namespaces[session.user.id]?.pendingOperations.length ?? 0
      if (isTransientCloudError(error)) {
        this.setRuntimeState(
          'offline',
          pendingCount > 0
            ? `Cloud service is unavailable; ${pendingCount} change${
                pendingCount === 1 ? '' : 's'
              } remain safely queued. ${getErrorMessage(error)}`
            : `Cloud service is unavailable. Local ownership remains active. ${getErrorMessage(error)}`
        )
        return
      }
      this.setRuntimeState('error', `Cloud synchronization failed: ${getErrorMessage(error)}`)
    }
  }

  private async restoreSnapshot(): Promise<void> {
    const session = this.state.session
    if (!session) throw new Error('Cloud session is unavailable.')
    const snapshot = await this.withAuthenticatedRetry((accessToken, signal) =>
      this.api.getOwnershipSnapshot(accessToken, signal)
    )
    const next = cloneCloudState(this.state)
    replaceCloudSnapshot(getOrCreateNamespace(next, session.user.id), snapshot)
    await this.commit(next)
    this.onOwnershipChange()
  }

  private async captureProfiles(allowReassociation: boolean): Promise<boolean> {
    const session = this.state.session
    const next = cloneCloudState(this.state)
    const result = captureLocalProfiles(
      next,
      session?.user.id ?? null,
      this.getLocalProfiles(),
      allowReassociation,
      this.maxPendingOperations
    )
    this.blockedProfileKeys = result.blockedProfileKeys
    if (
      result.queued > 0 ||
      JSON.stringify(next.profileAssociations) !== JSON.stringify(this.state.profileAssociations)
    ) {
      await this.commit(next)
      this.onOwnershipChange()
    }
    return result.hasMore
  }

  private async ensureAccessToken(force = false): Promise<string> {
    if (
      !force &&
      this.accessToken &&
      this.accessTokenExpiresAt - ACCESS_TOKEN_REFRESH_MARGIN_MS > this.now().getTime()
    ) {
      return this.accessToken
    }
    const refreshToken = this.refreshToken
    if (!refreshToken) throw new Error('Cloud refresh token is unavailable.')
    const encryptedRefreshToken = await this.clearPersistedRefreshToken()
    this.refreshToken = null
    let tokens: CloudTokenPair
    try {
      tokens = await this.api.refresh(refreshToken, this.abortController.signal)
    } catch (error) {
      if (isDefinitelyUnsentRefreshError(error)) {
        this.refreshToken = refreshToken
        await this.restorePersistedRefreshToken(encryptedRefreshToken)
        throw error
      }
      await this.clearSession(
        'Rockfall could not safely determine whether the rotating refresh token was consumed.'
      )
      throw new CloudAuthenticationExpiredError('The cloud session must be authorized again.')
    }
    const existingUserId = this.state.session?.user.id
    if (existingUserId && tokens.user.id !== existingUserId) {
      await this.clearSession('The refreshed cloud session belongs to another user.')
      throw new CloudAuthenticationExpiredError(
        'The refreshed cloud session belongs to another user.'
      )
    }
    await this.acceptTokenPair(tokens)
    return tokens.accessToken
  }

  private async withAuthenticatedRetry<T>(
    operation: (accessToken: string, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    let accessToken = await this.ensureAccessToken()
    try {
      return await this.withRetry((signal) => operation(accessToken, signal))
    } catch (error) {
      if (!(error instanceof CloudApiError) || error.status !== 401) throw error
      accessToken = await this.ensureAccessToken(true)
      return this.withRetry((signal) => operation(accessToken, signal))
    }
  }

  private async acceptTokenPair(tokens: CloudTokenPair): Promise<void> {
    this.refreshToken = tokens.refreshToken
    this.accessToken = tokens.accessToken
    this.accessTokenExpiresAt = this.now().getTime() + tokens.expiresIn * 1_000
    let encryptedRefreshToken: string | null = null
    if (this.tokenProtector.isEncryptionAvailable()) {
      try {
        encryptedRefreshToken = this.tokenProtector.encrypt(tokens.refreshToken)
      } catch {
        encryptedRefreshToken = null
      }
    }
    const next = cloneCloudState(this.state)
    next.lastUserId = tokens.user.id
    next.session = {
      apiUrl: this.apiUrl,
      user: tokens.user,
      encryptedRefreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt
    }
    getOrCreateNamespace(next, tokens.user.id)
    await this.commit(next)
  }

  private async applyAuthoritativeRole(role: 'user' | 'admin'): Promise<void> {
    const session = this.state.session
    if (!session || session.user.role === role) return
    const next = cloneCloudState(this.state)
    if (!next.session) return
    next.session.user = { ...next.session.user, role }
    await this.commit(next)
  }

  private async clearPersistedRefreshToken(): Promise<string | null> {
    const encryptedRefreshToken = this.state.session?.encryptedRefreshToken ?? null
    if (!encryptedRefreshToken) return null
    const next = cloneCloudState(this.state)
    if (next.session) next.session.encryptedRefreshToken = null
    await this.commit(next)
    return encryptedRefreshToken
  }

  private async restorePersistedRefreshToken(encryptedRefreshToken: string | null): Promise<void> {
    if (!encryptedRefreshToken || !this.state.session) return
    const next = cloneCloudState(this.state)
    if (next.session) next.session.encryptedRefreshToken = encryptedRefreshToken
    await this.commit(next)
  }

  private async clearSession(message: string): Promise<void> {
    this.pendingLogin = null
    this.accessToken = null
    this.accessTokenExpiresAt = 0
    this.refreshToken = null
    if (this.state.session) {
      const next = cloneCloudState(this.state)
      next.session = null
      await this.commit(next)
    }
    this.setRuntimeState('signed-out', message)
  }

  private async commit(next: CloudStateData): Promise<void> {
    await saveCloudState(this.storePath, next)
    this.state = next
    this.emitState()
  }

  private withRetry<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return retryCloudOperation(operation, this.abortController.signal, this.sleep)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Cloud sync has been stopped.'))
    const request = this.operationQueue.catch(() => undefined).then(operation)
    this.operationQueue = request.then(
      () => undefined,
      () => undefined
    )
    return request
  }

  private setRuntimeState(status: CloudSyncStatus, message: string): void {
    this.status = status
    this.message = message
    this.emitState()
  }

  private emitState(): void {
    if (!this.disposed) this.onStateChange(this.getSnapshot())
  }

  private startTimer(): void {
    if (this.syncTimer || this.disposed) return
    this.syncTimer = setInterval(() => {
      void this.syncNow()
    }, this.syncIntervalMs)
    this.syncTimer.unref()
  }
}

export function parseCloudLoginUrl(value: string): CloudLoginCallback {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('Discord callback must be a valid Rockfall URL.')
  }
  if (url.protocol !== 'rockfall:' || url.hostname !== 'auth' || url.pathname !== '/discord') {
    throw new TypeError('Discord callback is not a Rockfall authentication URL.')
  }
  const loginRequestId = url.searchParams.get('loginRequestId')
  const handoffCode = url.searchParams.get('handoffCode')
  if (!loginRequestId || !handoffCode) {
    throw new TypeError('Discord callback is missing its request ID or handoff code.')
  }
  return { loginRequestId, handoffCode }
}

export function selectSyncOperations(
  cursor: string,
  pendingOperations: readonly CloudSyncOperation[]
): CloudSyncOperation[] {
  const prefixBytes = Buffer.byteLength(
    `{"cursor":${JSON.stringify(cursor)},"operations":[`,
    'utf8'
  )
  const suffixBytes = 2
  let requestBytes = prefixBytes + suffixBytes
  const selected: CloudSyncOperation[] = []

  for (const operation of pendingOperations) {
    if (selected.length >= MAX_SYNC_BATCH) break
    const operationBytes = Buffer.byteLength(JSON.stringify(operation), 'utf8')
    const candidateBytes = requestBytes + operationBytes + (selected.length > 0 ? 1 : 0)
    if (candidateBytes > MAX_SYNC_REQUEST_BYTES) break
    selected.push(operation)
    requestBytes = candidateBytes
  }

  if (pendingOperations.length > 0 && selected.length === 0) {
    throw new RangeError('A pending cloud operation exceeds the sync request-size limit.')
  }
  return selected
}

async function retryCloudOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation(signal)
    } catch (error) {
      lastError = error
      if (!isTransientCloudError(error) || attempt === MAX_RETRY_ATTEMPTS - 1) throw error
      const retryAfter =
        error instanceof CloudApiError && error.retryAfterSeconds !== null
          ? error.retryAfterSeconds * 1_000
          : RETRY_DELAYS_MS[attempt]
      await sleep(retryAfter, signal)
    }
  }
  throw lastError
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Cloud sync was cancelled.'))
      return
    }
    const complete = (): void => {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(complete, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      reject(new Error('Cloud sync was cancelled.'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function sanitizeUser(user: CloudAuthenticatedUser): CloudUserSummary {
  return { id: user.id, displayName: user.displayName, role: user.role }
}

function toStaticDataPublishResult(
  result: CloudStaticDataPublishResult
): StaticDataPublicationResult {
  return {
    status: result.status,
    releaseId: result.releaseId,
    contractVersion: result.contractVersion,
    channel: result.channel,
    gameBuild: result.gameBuild,
    gameVersion: result.gameVersion,
    contentSetSha256: result.contentSetSha256,
    publishedAt: result.publishedAt,
    current: result.current,
    manifestUrl: result.manifestUrl
  }
}

function isAuthenticationError(error: unknown): boolean {
  return (
    error instanceof CloudAuthenticationExpiredError ||
    (error instanceof CloudApiError && error.status === 401)
  )
}

function isDefinitelyUnsentRefreshError(error: unknown): boolean {
  return (
    error instanceof CloudNetworkError &&
    ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error.code ?? '')
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
