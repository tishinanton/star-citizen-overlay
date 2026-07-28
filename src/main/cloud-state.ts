import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

import type {
  CloudAuthenticatedUser,
  CloudManualBlueprint,
  CloudOwnershipSnapshot,
  CloudProfileIdentity,
  CloudProfileSnapshot,
  CloudReceipt,
  CloudSyncChange,
  CloudSyncOperation,
  CloudSyncResponse
} from './cloud-api'
import type {
  CloudOwnershipLayer,
  OwnershipProfileIdentity,
  OwnershipSyncProfile
} from './blueprint-ownership'
import { normalizeBlueprintName } from './blueprint-log'
import { normalizeCloudApiUrl } from './cloud-url'

const CLOUD_STATE_SCHEMA_VERSION = 1
const MAX_NAMESPACES = 10
const MAX_PROFILES = 30
const MAX_PENDING_OPERATIONS = 10_000
const MAX_QUARANTINED_OPERATIONS = 100
const MAX_REJECTED_OPERATION_FINGERPRINTS = 100_000
const CHANNEL_PATTERN = /^[A-Z0-9_-]{1,32}$/
const ACCOUNT_ID_PATTERN = /^[0-9]{1,100}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface CloudSessionRecord {
  apiUrl: string
  user: CloudAuthenticatedUser
  encryptedRefreshToken: string | null
  refreshExpiresAt: string
}

export interface CachedCloudProfile extends CloudProfileIdentity {
  profileId: string | null
  receipts: Record<string, CloudReceipt>
  manualBlueprints: Record<string, CloudManualBlueprint>
}

export interface QuarantinedCloudOperation {
  operation: CloudSyncOperation
  code: string
  detail: string
  rejectedAt: string
}

export interface CloudUserNamespace {
  hasSnapshot: boolean
  cursor: string
  profiles: Record<string, CachedCloudProfile>
  pendingOperations: CloudSyncOperation[]
  quarantinedOperations: QuarantinedCloudOperation[]
  rejectedOperationFingerprints: Record<string, string>
  lastSyncedAt: string | null
}

export interface CloudStateData {
  schemaVersion: number
  installationId: string
  lastUserId: string | null
  session: CloudSessionRecord | null
  namespaces: Record<string, CloudUserNamespace>
  profileAssociations: Record<string, string>
}

export interface LoadedCloudState {
  state: CloudStateData
  warning: string | null
  needsSave: boolean
}

export interface CaptureLocalProfilesResult {
  queued: number
  blockedProfileKeys: string[]
  hasMore: boolean
}

export interface EnqueueManualOperationResult {
  queued: boolean
  targetUserId: string | null
  blockedProfileKey: string | null
}

export function createCloudState(installationId = randomUUID()): CloudStateData {
  return {
    schemaVersion: CLOUD_STATE_SCHEMA_VERSION,
    installationId,
    lastUserId: null,
    session: null,
    namespaces: {},
    profileAssociations: {}
  }
}

export function cloneCloudState(state: CloudStateData): CloudStateData {
  return structuredClone(state)
}

export async function loadCloudState(path: string): Promise<LoadedCloudState> {
  try {
    return {
      state: parseCloudState(JSON.parse(await fs.readFile(path, 'utf8')) as unknown),
      warning: null,
      needsSave: false
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { state: createCloudState(), warning: null, needsSave: true }
    }
    const recovery = await createRecoveryCopy(path)
    const message = error instanceof Error ? error.message : String(error)
    return {
      state: createCloudState(),
      warning: recovery.path
        ? `Saved cloud sync state could not be loaded: ${message}. The original file was preserved at ${recovery.path}.`
        : `Saved cloud sync state could not be loaded: ${message}. A recovery copy could not be created: ${recovery.error}`,
      needsSave: true
    }
  }
}

export async function saveCloudState(path: string, state: CloudStateData): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, path)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}

export function parseCloudState(value: unknown): CloudStateData {
  const record = readRecord(value, 'Cloud state')
  if (record.schemaVersion !== CLOUD_STATE_SCHEMA_VERSION) {
    throw new TypeError('The cloud state file has an unsupported schema version.')
  }
  const installationId = readUuid(record.installationId, 'Installation ID')
  const lastUserId =
    record.lastUserId === null ? null : readUuid(record.lastUserId, 'Last cloud user ID')
  const session = record.session === null ? null : parseSession(record.session)
  const namespaceRecord = readRecord(record.namespaces, 'Cloud namespaces')
  const namespaceEntries = Object.entries(namespaceRecord)
  if (namespaceEntries.length > MAX_NAMESPACES) {
    throw new RangeError(`No more than ${MAX_NAMESPACES} cloud users can be cached.`)
  }
  const namespaces: Record<string, CloudUserNamespace> = {}
  for (const [userId, namespace] of namespaceEntries) {
    readUuid(userId, 'Cloud namespace user ID')
    namespaces[userId] = parseNamespace(namespace)
  }

  const associationRecord = readRecord(record.profileAssociations, 'Profile associations')
  const profileAssociations: Record<string, string> = {}
  for (const [key, userId] of Object.entries(associationRecord)) {
    if (key.length === 0 || key.length > 200) {
      throw new TypeError('Cloud profile association has an invalid key.')
    }
    profileAssociations[key] = readUuid(userId, 'Associated cloud user ID')
  }

  return {
    schemaVersion: CLOUD_STATE_SCHEMA_VERSION,
    installationId,
    lastUserId,
    session,
    namespaces,
    profileAssociations
  }
}

export function getOrCreateNamespace(state: CloudStateData, userId: string): CloudUserNamespace {
  const existing = state.namespaces[userId]
  if (existing) return existing
  if (Object.keys(state.namespaces).length >= MAX_NAMESPACES) {
    throw new RangeError(`No more than ${MAX_NAMESPACES} cloud users can be cached.`)
  }
  const namespace: CloudUserNamespace = {
    hasSnapshot: false,
    cursor: '',
    profiles: {},
    pendingOperations: [],
    quarantinedOperations: [],
    rejectedOperationFingerprints: {},
    lastSyncedAt: null
  }
  state.namespaces[userId] = namespace
  return namespace
}

export function replaceCloudSnapshot(
  namespace: CloudUserNamespace,
  snapshot: CloudOwnershipSnapshot
): void {
  namespace.profiles = Object.fromEntries(
    snapshot.profiles.map((profile) => [cloudProfileKey(profile), cacheSnapshotProfile(profile)])
  )
  namespace.cursor = snapshot.cursor
  namespace.hasSnapshot = true
}

export function captureLocalProfiles(
  state: CloudStateData,
  userId: string | null,
  localProfiles: readonly OwnershipSyncProfile[],
  allowReassociation = false,
  maxPendingOperations = MAX_PENDING_OPERATIONS
): CaptureLocalProfilesResult {
  let queued = 0
  const blockedProfileKeys: string[] = []

  for (const profile of localProfiles) {
    const channel = profile.channel.trim().toUpperCase()
    const accountId = profile.accountId.trim()
    if (!CHANNEL_PATTERN.test(channel) || !ACCOUNT_ID_PATTERN.test(accountId)) continue
    const identity: CloudProfileIdentity = {
      channel,
      accountId,
      handle: normalizeHandle(profile.handle)
    }
    const key = cloudProfileKey(identity)
    const association = state.profileAssociations[key]
    let targetUserId = association ?? userId
    if (association && userId && association !== userId) {
      if (allowReassociation) {
        movePendingOperations(state, key, association, userId)
        state.profileAssociations[key] = userId
        targetUserId = userId
      } else {
        blockedProfileKeys.push(key)
        continue
      }
    } else if (!association && userId) {
      state.profileAssociations[key] = userId
    }
    if (!targetUserId) continue
    const namespace = getOrCreateNamespace(state, targetUserId)

    for (const receipt of profile.receipts) {
      const normalizedName = normalizeBlueprintName(receipt.name)
      const cached = namespace.profiles[key]?.receipts[normalizedName]
      const pending = namespace.pendingOperations.filter(
        (operation): operation is Extract<CloudSyncOperation, { kind: 'receipt.upsert' }> =>
          operation.kind === 'receipt.upsert' &&
          cloudProfileKey(operation.profile) === key &&
          normalizeBlueprintName(operation.receipt.name) === normalizedName
      )
      const coveredTimestamps = [
        cached?.firstSeenAt,
        cached?.lastSeenAt,
        ...pending.flatMap((item) => [item.receipt.firstSeenAt, item.receipt.lastSeenAt])
      ]
        .filter((timestamp): timestamp is string => Boolean(timestamp))
        .map((timestamp) => Date.parse(timestamp))
      const localFirstSeenAt = Date.parse(receipt.firstSeenAt)
      const localLastSeenAt = Date.parse(receipt.lastSeenAt)
      if (
        coveredTimestamps.length > 0 &&
        Math.min(...coveredTimestamps) <= localFirstSeenAt &&
        Math.max(...coveredTimestamps) >= localLastSeenAt
      ) {
        continue
      }
      const operation: CloudSyncOperation = {
        operationId: randomUUID(),
        kind: 'receipt.upsert',
        profile: identity,
        receipt: {
          name: receipt.name,
          firstSeenAt: receipt.firstSeenAt,
          lastSeenAt: receipt.lastSeenAt
        }
      }
      if (isPermanentlyRejected(namespace, operation)) continue
      if (!pushPendingOperation(namespace, operation, maxPendingOperations)) {
        return { queued, blockedProfileKeys, hasMore: true }
      }
      queued += 1
    }

    for (const manual of profile.manualBlueprints) {
      if (
        findCachedManual(
          namespace.profiles[key],
          manual.blueprintId,
          manual.blueprintKey,
          manual.keyIsUnique === true
        ) ||
        findPendingManual(
          namespace,
          key,
          manual.blueprintId,
          manual.blueprintKey,
          manual.keyIsUnique === true
        )
      ) {
        continue
      }
      const operation: CloudSyncOperation = {
        operationId: randomUUID(),
        kind: 'manual.set',
        profile: identity,
        manual: {
          blueprintId: manual.blueprintId,
          blueprintKey: manual.blueprintKey,
          owned: true,
          changedAt: new Date().toISOString(),
          blueprintKeyIsUnique: manual.keyIsUnique === true
        }
      }
      if (isPermanentlyRejected(namespace, operation)) continue
      if (!pushPendingOperation(namespace, operation, maxPendingOperations)) {
        return { queued, blockedProfileKeys, hasMore: true }
      }
      queued += 1
    }
  }

  return { queued, blockedProfileKeys, hasMore: false }
}

export function enqueueManualOperation(
  state: CloudStateData,
  userId: string | null,
  profile: OwnershipProfileIdentity,
  manual: { blueprintId: string; blueprintKey: string; owned: boolean; changedAt: string },
  keyIsUnique = false
): EnqueueManualOperationResult {
  const channel = profile.channel.trim().toUpperCase()
  const accountId = profile.accountId.trim()
  if (!CHANNEL_PATTERN.test(channel) || !ACCOUNT_ID_PATTERN.test(accountId)) {
    return { queued: false, targetUserId: null, blockedProfileKey: null }
  }
  const identity: CloudProfileIdentity = {
    channel,
    accountId,
    handle: normalizeHandle(profile.handle)
  }
  const key = cloudProfileKey(identity)
  const association = state.profileAssociations[key]
  const targetUserId = association ?? userId
  if (!targetUserId) {
    return { queued: false, targetUserId: null, blockedProfileKey: null }
  }
  const blockedProfileKey = userId && association && association !== userId ? key : null
  if (!association) state.profileAssociations[key] = targetUserId
  const namespace = getOrCreateNamespace(state, targetUserId)
  const lastMatching = [...namespace.pendingOperations]
    .reverse()
    .filter(
      (operation): operation is Extract<CloudSyncOperation, { kind: 'manual.set' }> =>
        operation.kind === 'manual.set' && cloudProfileKey(operation.profile) === key
    )
  const matchingPending = findManualOperation(
    lastMatching,
    manual.blueprintId,
    manual.blueprintKey,
    keyIsUnique
  )
  if (matchingPending?.manual.owned === manual.owned) {
    return { queued: false, targetUserId, blockedProfileKey }
  }

  const operation: CloudSyncOperation = {
    operationId: randomUUID(),
    kind: 'manual.set',
    profile: identity,
    manual: {
      ...manual,
      blueprintKeyIsUnique: keyIsUnique
    }
  }
  if (isPermanentlyRejected(namespace, operation)) {
    return { queued: false, targetUserId, blockedProfileKey }
  }
  if (!pushPendingOperation(namespace, operation)) {
    throw new RangeError('Cloud sync has reached the pending-operation limit.')
  }
  return { queued: true, targetUserId, blockedProfileKey }
}

export function applyCloudSyncResponse(
  namespace: CloudUserNamespace,
  response: CloudSyncResponse,
  attemptedOperationIds: ReadonlySet<string>,
  appliedAt: string,
  isBlueprintKeyUnique: (blueprintKey: string) => boolean = () => false
): void {
  const acknowledged = new Set(response.acknowledgedOperationIds)
  const rejected = new Map(
    response.rejectedOperations.map((rejection) => [rejection.operationId, rejection])
  )
  for (const operationId of [...acknowledged, ...rejected.keys()]) {
    if (!attemptedOperationIds.has(operationId)) {
      throw new TypeError('Cloud sync acknowledged an operation that was not submitted.')
    }
  }

  const remaining: CloudSyncOperation[] = []
  for (const operation of namespace.pendingOperations) {
    if (acknowledged.has(operation.operationId)) {
      delete namespace.rejectedOperationFingerprints[operationFingerprintKey(operation)]
      continue
    }
    const rejection = rejected.get(operation.operationId)
    if (!rejection || rejection.retryable) {
      remaining.push(operation)
      continue
    }
    namespace.quarantinedOperations.push({
      operation,
      code: rejection.code,
      detail: rejection.detail,
      rejectedAt: appliedAt
    })
    setRejectedOperationFingerprint(namespace, operation)
  }
  namespace.pendingOperations = remaining
  if (namespace.quarantinedOperations.length > MAX_QUARANTINED_OPERATIONS) {
    namespace.quarantinedOperations.splice(
      0,
      namespace.quarantinedOperations.length - MAX_QUARANTINED_OPERATIONS
    )
  }

  for (const change of response.changes) {
    applyCloudChange(namespace, change, isBlueprintKeyUnique)
  }
  namespace.cursor = response.nextCursor
  namespace.hasSnapshot = true
  namespace.lastSyncedAt = appliedAt
}

export function getCloudOwnershipLayer(
  state: CloudStateData,
  activeProfile: { channel: string; accountId: string | null } | null
): CloudOwnershipLayer | null {
  const profile = findActiveCloudProfile(state, activeProfile)
  if (!profile) return null
  const userId = state.session?.user.id ?? state.lastUserId
  if (!userId) return null
  const namespace = state.namespaces[userId]
  if (!namespace) return null

  const manualBlueprints = Object.values(profile.manualBlueprints).map((manual) => ({ ...manual }))
  for (const operation of namespace.pendingOperations) {
    if (operation.kind !== 'manual.set') continue
    if (cloudProfileKey(operation.profile) !== cloudProfileKey(profile)) continue
    for (let index = manualBlueprints.length - 1; index >= 0; index -= 1) {
      const existing = manualBlueprints[index]
      if (existing.blueprintId === operation.manual.blueprintId) {
        manualBlueprints.splice(index, 1)
      }
    }
    manualBlueprints.push({ ...operation.manual })
  }

  return {
    receipts: Object.values(profile.receipts).map((receipt) => ({ ...receipt })),
    manualBlueprints
  }
}

export function getCloudOwnershipProfileIdentity(
  state: CloudStateData,
  activeProfile: { channel: string; accountId: string | null } | null
): OwnershipProfileIdentity | null {
  const profile = findActiveCloudProfile(state, activeProfile)
  return profile
    ? {
        channel: profile.channel,
        accountId: profile.accountId,
        handle: profile.handle
      }
    : null
}

function findActiveCloudProfile(
  state: CloudStateData,
  activeProfile: { channel: string; accountId: string | null } | null
): CachedCloudProfile | null {
  const userId = state.session?.user.id ?? state.lastUserId
  if (!userId || !activeProfile) return null
  const namespace = state.namespaces[userId]
  if (!namespace?.hasSnapshot) return null
  const channel = activeProfile.channel.trim().toUpperCase()
  const profile = activeProfile.accountId
    ? namespace.profiles[cloudProfileKey({ ...activeProfile, accountId: activeProfile.accountId })]
    : uniqueProfileForChannel(namespace, channel)
  return profile ?? null
}

export function cloudProfileKey(
  profile: Pick<CloudProfileIdentity, 'channel' | 'accountId'>
): string {
  return `${profile.channel.trim().toUpperCase()}:${profile.accountId.trim()}`
}

function applyCloudChange(
  namespace: CloudUserNamespace,
  change: CloudSyncChange,
  isBlueprintKeyUnique: (blueprintKey: string) => boolean
): void {
  const key = cloudProfileKey(change.profile)
  const profile =
    namespace.profiles[key] ??
    (namespace.profiles[key] = {
      profileId: null,
      channel: change.profile.channel.trim().toUpperCase(),
      accountId: change.profile.accountId.trim(),
      handle: normalizeHandle(change.profile.handle),
      receipts: {},
      manualBlueprints: {}
    })
  if (change.profile.handle) profile.handle = change.profile.handle
  if (change.kind === 'profile.upsert') return
  if (change.kind === 'receipt.upsert') {
    mergeCachedReceipt(profile, change.receipt)
    return
  }
  setCachedManual(profile, change.manual, isBlueprintKeyUnique(change.manual.blueprintKey))
}

function cacheSnapshotProfile(profile: CloudProfileSnapshot): CachedCloudProfile {
  const cached: CachedCloudProfile = {
    profileId: profile.profileId,
    channel: profile.channel.trim().toUpperCase(),
    accountId: profile.accountId.trim(),
    handle: normalizeHandle(profile.handle),
    receipts: {},
    manualBlueprints: {}
  }
  for (const receipt of profile.receipts) mergeCachedReceipt(cached, receipt)
  for (const manual of profile.manualBlueprints) setCachedManual(cached, manual, false)
  return cached
}

function mergeCachedReceipt(profile: CachedCloudProfile, receipt: CloudReceipt): void {
  const key = receipt.normalizedName || normalizeBlueprintName(receipt.name)
  const existing = profile.receipts[key]
  if (!existing) {
    profile.receipts[key] = { ...receipt, normalizedName: key }
    return
  }
  if (Date.parse(receipt.firstSeenAt) < Date.parse(existing.firstSeenAt)) {
    existing.firstSeenAt = receipt.firstSeenAt
  }
  if (Date.parse(receipt.lastSeenAt) >= Date.parse(existing.lastSeenAt)) {
    existing.lastSeenAt = receipt.lastSeenAt
    existing.name = receipt.name
  }
}

function setCachedManual(
  profile: CachedCloudProfile,
  manual: CloudManualBlueprint,
  keyIsUnique: boolean
): void {
  if (keyIsUnique) {
    for (const [blueprintId, existing] of Object.entries(profile.manualBlueprints)) {
      if (blueprintId !== manual.blueprintId && existing.blueprintKey === manual.blueprintKey) {
        delete profile.manualBlueprints[blueprintId]
      }
    }
  }
  profile.manualBlueprints[manual.blueprintId] = { ...manual }
}

function findCachedManual(
  profile: CachedCloudProfile | undefined,
  blueprintId: string,
  blueprintKey: string,
  keyIsUnique: boolean
): CloudManualBlueprint | null {
  if (!profile) return null
  return findManualValue(
    Object.values(profile.manualBlueprints),
    blueprintId,
    blueprintKey,
    keyIsUnique
  )
}

function findPendingManual(
  namespace: CloudUserNamespace,
  profileKey: string,
  blueprintId: string,
  blueprintKey: string,
  keyIsUnique: boolean
): Extract<CloudSyncOperation, { kind: 'manual.set' }> | null {
  return findManualOperation(
    namespace.pendingOperations.filter(
      (candidate): candidate is Extract<CloudSyncOperation, { kind: 'manual.set' }> =>
        candidate.kind === 'manual.set' && cloudProfileKey(candidate.profile) === profileKey
    ),
    blueprintId,
    blueprintKey,
    keyIsUnique
  )
}

function findManualValue<T extends { blueprintId: string; blueprintKey: string }>(
  values: readonly T[],
  blueprintId: string,
  blueprintKey: string,
  keyIsUnique: boolean
): T | null {
  const exact = values.find((value) => value.blueprintId === blueprintId)
  if (exact) return exact
  if (!keyIsUnique) return null
  const keyMatches = values.filter((value) => value.blueprintKey === blueprintKey)
  return keyMatches.length === 1 ? keyMatches[0] : null
}

function findManualOperation(
  operations: readonly Extract<CloudSyncOperation, { kind: 'manual.set' }>[],
  blueprintId: string,
  blueprintKey: string,
  keyIsUnique: boolean
): Extract<CloudSyncOperation, { kind: 'manual.set' }> | null {
  const values = operations.map((operation) => operation.manual)
  const manual = findManualValue(values, blueprintId, blueprintKey, keyIsUnique)
  return manual ? (operations.find((operation) => operation.manual === manual) ?? null) : null
}

function isPermanentlyRejected(
  namespace: CloudUserNamespace,
  operation: CloudSyncOperation
): boolean {
  return (
    namespace.rejectedOperationFingerprints[operationFingerprintKey(operation)] ===
    operationPayloadFingerprint(operation)
  )
}

function setRejectedOperationFingerprint(
  namespace: CloudUserNamespace,
  operation: CloudSyncOperation
): void {
  const key = operationFingerprintKey(operation)
  if (
    !(key in namespace.rejectedOperationFingerprints) &&
    Object.keys(namespace.rejectedOperationFingerprints).length >=
      MAX_REJECTED_OPERATION_FINGERPRINTS
  ) {
    throw new RangeError('Cloud sync has reached the rejected-operation fingerprint limit.')
  }
  namespace.rejectedOperationFingerprints[key] = operationPayloadFingerprint(operation)
}

function operationFingerprintKey(operation: CloudSyncOperation): string {
  const profile = cloudProfileKey(operation.profile)
  return operation.kind === 'receipt.upsert'
    ? `${profile}|receipt|${normalizeBlueprintName(operation.receipt.name)}`
    : `${profile}|manual|${operation.manual.blueprintId}`
}

function operationPayloadFingerprint(operation: CloudSyncOperation): string {
  const payload =
    operation.kind === 'receipt.upsert'
      ? {
          kind: operation.kind,
          profile: cloudProfileKey(operation.profile),
          receipt: operation.receipt
        }
      : {
          kind: operation.kind,
          profile: cloudProfileKey(operation.profile),
          manual: {
            blueprintId: operation.manual.blueprintId,
            blueprintKey: operation.manual.blueprintKey,
            owned: operation.manual.owned,
            blueprintKeyIsUnique: operation.manual.blueprintKeyIsUnique
          }
        }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function movePendingOperations(
  state: CloudStateData,
  profileKey: string,
  fromUserId: string,
  toUserId: string
): void {
  const source = state.namespaces[fromUserId]
  if (!source) return
  const moving = source.pendingOperations.filter(
    (operation) => cloudProfileKey(operation.profile) === profileKey
  )
  if (moving.length === 0) return
  const target = getOrCreateNamespace(state, toUserId)
  if (target.pendingOperations.length + moving.length > MAX_PENDING_OPERATIONS) {
    throw new RangeError('Cloud sync has reached the pending-operation limit.')
  }
  const existingIds = new Set(target.pendingOperations.map((operation) => operation.operationId))
  target.pendingOperations.push(
    ...moving.filter((operation) => !existingIds.has(operation.operationId))
  )
  source.pendingOperations = source.pendingOperations.filter(
    (operation) => cloudProfileKey(operation.profile) !== profileKey
  )
}

function pushPendingOperation(
  namespace: CloudUserNamespace,
  operation: CloudSyncOperation,
  maxPendingOperations = MAX_PENDING_OPERATIONS
): boolean {
  if (namespace.pendingOperations.length >= maxPendingOperations) return false
  namespace.pendingOperations.push(operation)
  return true
}

function uniqueProfileForChannel(
  namespace: CloudUserNamespace,
  channel: string
): CachedCloudProfile | null {
  const matches = Object.values(namespace.profiles).filter(
    (profile) => profile.channel.toUpperCase() === channel
  )
  return matches.length === 1 ? matches[0] : null
}

function parseSession(value: unknown): CloudSessionRecord {
  const record = readRecord(value, 'Cloud session')
  return {
    apiUrl: normalizeCloudApiUrl(record.apiUrl),
    user: parseUser(record.user),
    encryptedRefreshToken:
      record.encryptedRefreshToken === null
        ? null
        : readString(record.encryptedRefreshToken, 'Encrypted refresh token', 100_000),
    refreshExpiresAt: readTimestamp(record.refreshExpiresAt, 'Refresh-token expiry')
  }
}

function parseUser(value: unknown): CloudAuthenticatedUser {
  const record = readRecord(value, 'Cloud user')
  return {
    id: readUuid(record.id, 'Cloud user ID'),
    discordUserId: readNonEmptyString(record.discordUserId, 'Discord user ID', 100),
    displayName: readNonEmptyString(record.displayName, 'Cloud display name', 200),
    avatarHash:
      record.avatarHash === null ? null : readString(record.avatarHash, 'Discord avatar hash', 500)
  }
}

function parseNamespace(value: unknown): CloudUserNamespace {
  const record = readRecord(value, 'Cloud user namespace')
  const profileRecord = readRecord(record.profiles, 'Cached cloud profiles')
  const profileEntries = Object.entries(profileRecord)
  if (profileEntries.length > MAX_PROFILES) {
    throw new RangeError(`No more than ${MAX_PROFILES} cloud profiles can be cached.`)
  }
  const profiles: Record<string, CachedCloudProfile> = {}
  for (const [key, profile] of profileEntries) {
    const parsed = parseCachedProfile(profile)
    if (key !== cloudProfileKey(parsed)) {
      throw new TypeError('Cached cloud profile has a mismatched key.')
    }
    profiles[key] = parsed
  }
  const pendingValues = readArray(record.pendingOperations, 'Pending cloud operations')
  if (pendingValues.length > MAX_PENDING_OPERATIONS) {
    throw new RangeError('Cloud sync has too many pending operations.')
  }
  const quarantineValues = readArray(record.quarantinedOperations, 'Quarantined cloud operations')
  if (quarantineValues.length > MAX_QUARANTINED_OPERATIONS) {
    throw new RangeError('Cloud sync has too many quarantined operations.')
  }
  const fingerprintRecord =
    record.rejectedOperationFingerprints === undefined
      ? {}
      : readRecord(record.rejectedOperationFingerprints, 'Rejected operation fingerprints')
  const fingerprintEntries = Object.entries(fingerprintRecord)
  if (fingerprintEntries.length > MAX_REJECTED_OPERATION_FINGERPRINTS) {
    throw new RangeError('Cloud sync has too many rejected-operation fingerprints.')
  }
  const rejectedOperationFingerprints = Object.fromEntries(
    fingerprintEntries.map(([key, value]) => {
      if (key.length === 0 || key.length > 1_000) {
        throw new TypeError('Rejected operation fingerprint has an invalid key.')
      }
      const fingerprint = readString(value, 'Rejected operation fingerprint', 64)
      if (!/^[0-9a-f]{64}$/i.test(fingerprint)) {
        throw new TypeError('Rejected operation fingerprint must be SHA-256.')
      }
      return [key, fingerprint]
    })
  )
  return {
    hasSnapshot: readBoolean(record.hasSnapshot, 'Cloud snapshot state'),
    cursor: readString(record.cursor, 'Cloud sync cursor', 100),
    profiles,
    pendingOperations: pendingValues.map(parseSyncOperation),
    quarantinedOperations: quarantineValues.map(parseQuarantinedOperation),
    rejectedOperationFingerprints,
    lastSyncedAt:
      record.lastSyncedAt === null ? null : readTimestamp(record.lastSyncedAt, 'Last sync time')
  }
}

function parseCachedProfile(value: unknown): CachedCloudProfile {
  const record = readRecord(value, 'Cached cloud profile')
  const identity = parseProfileIdentity(record)
  const receiptRecord = readRecord(record.receipts, 'Cached receipts')
  const manualRecord = readRecord(record.manualBlueprints, 'Cached manual states')
  return {
    profileId: record.profileId === null ? null : readUuid(record.profileId, 'Cloud profile ID'),
    ...identity,
    receipts: Object.fromEntries(
      Object.entries(receiptRecord).map(([key, receipt]) => {
        const parsed = parseReceipt(receipt)
        if (key !== parsed.normalizedName) {
          throw new TypeError('Cached receipt has a mismatched normalized key.')
        }
        return [key, parsed]
      })
    ),
    manualBlueprints: Object.fromEntries(
      Object.entries(manualRecord).map(([key, manual]) => {
        const parsed = parseManual(manual)
        if (key !== parsed.blueprintId) {
          throw new TypeError('Cached manual state has a mismatched blueprint key.')
        }
        return [key, parsed]
      })
    )
  }
}

function parseSyncOperation(value: unknown): CloudSyncOperation {
  const record = readRecord(value, 'Cloud sync operation')
  const operationId = readUuid(record.operationId, 'Cloud operation ID')
  const kind = readNonEmptyString(record.kind, 'Cloud operation kind', 50)
  const profile = parseProfileIdentity(record.profile)
  if (kind === 'receipt.upsert') {
    const receipt = readRecord(record.receipt, 'Pending receipt')
    return {
      operationId,
      kind,
      profile,
      receipt: {
        name: readNonEmptyString(receipt.name, 'Pending receipt name', 500),
        firstSeenAt: readTimestamp(receipt.firstSeenAt, 'Pending receipt first-seen time'),
        lastSeenAt: readTimestamp(receipt.lastSeenAt, 'Pending receipt last-seen time')
      }
    }
  }
  if (kind === 'manual.set') {
    const manual = readRecord(record.manual, 'Pending manual state')
    return {
      operationId,
      kind,
      profile,
      manual: {
        ...parseManual(manual),
        blueprintKeyIsUnique:
          manual.blueprintKeyIsUnique === undefined
            ? false
            : readBoolean(manual.blueprintKeyIsUnique, 'Blueprint-key uniqueness')
      }
    }
  }
  throw new TypeError(`Cloud state contains unsupported operation kind "${kind}".`)
}

function parseQuarantinedOperation(value: unknown): QuarantinedCloudOperation {
  const record = readRecord(value, 'Quarantined cloud operation')
  return {
    operation: parseSyncOperation(record.operation),
    code: readNonEmptyString(record.code, 'Quarantine code', 200),
    detail: readNonEmptyString(record.detail, 'Quarantine detail', 2_000),
    rejectedAt: readTimestamp(record.rejectedAt, 'Quarantine time')
  }
}

function parseProfileIdentity(value: unknown): CloudProfileIdentity {
  const record = readRecord(value, 'Cloud profile identity')
  return {
    channel: readNonEmptyString(record.channel, 'Cloud profile channel', 32),
    accountId: readNonEmptyString(record.accountId, 'Cloud profile account ID', 100),
    handle: record.handle === null ? null : readString(record.handle, 'Cloud profile handle', 200)
  }
}

function parseReceipt(value: unknown): CloudReceipt {
  const record = readRecord(value, 'Cached cloud receipt')
  return {
    normalizedName: readNonEmptyString(record.normalizedName, 'Normalized receipt name', 500),
    name: readNonEmptyString(record.name, 'Receipt name', 500),
    firstSeenAt: readTimestamp(record.firstSeenAt, 'Receipt first-seen time'),
    lastSeenAt: readTimestamp(record.lastSeenAt, 'Receipt last-seen time')
  }
}

function parseManual(value: unknown): CloudManualBlueprint {
  const record = readRecord(value, 'Cached manual state')
  return {
    blueprintId: readNonEmptyString(record.blueprintId, 'Blueprint ID', 200),
    blueprintKey: readNonEmptyString(record.blueprintKey, 'Blueprint key', 500),
    owned: readBoolean(record.owned, 'Manual ownership state'),
    changedAt: readTimestamp(record.changedAt, 'Manual ownership change time')
  }
}

function normalizeHandle(value: string | null): string | null {
  const candidate = value?.trim() ?? ''
  return candidate.length > 0 ? candidate : null
}

async function createRecoveryCopy(
  path: string
): Promise<{ path: string | null; error: string | null }> {
  const recoveryPath = `${path}.recovery-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`
  try {
    await fs.copyFile(path, recoveryPath)
    return { path: recoveryPath, error: null }
  } catch (error) {
    return {
      path: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`)
  return value
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

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`)
  return value
}

function readTimestamp(value: unknown, label: string): string {
  const candidate = readNonEmptyString(value, label, 100)
  if (!Number.isFinite(Date.parse(candidate))) throw new TypeError(`${label} must be a timestamp.`)
  return candidate
}

function readUuid(value: unknown, label: string): string {
  const candidate = readNonEmptyString(value, label, 100)
  if (!UUID_PATTERN.test(candidate)) throw new TypeError(`${label} must be a UUID.`)
  return candidate
}
