import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

import type {
  BlueprintOwnershipRecord,
  BlueprintOwnershipSnapshot,
  BlueprintOwnershipStatus,
  BlueprintSummary
} from '../shared/contracts'
import type { GameDataArchive } from './game-data'
import {
  blueprintNameCandidates,
  BlueprintLogMonitor,
  normalizeBlueprintName,
  scanBlueprintLogs,
  type BlueprintLogIdentity,
  type BlueprintLogReceipt,
  type BlueprintLogScanResult
} from './blueprint-log'

const OWNERSHIP_SCHEMA_VERSION = 1
const MANUAL_ACCOUNT = 'manual'
const CACHED_CHANNEL = 'CACHED'
const MAX_PROFILES = 30
const MAX_RECEIPTS_PER_PROFILE = 5_000
const MAX_MANUAL_BLUEPRINTS_PER_PROFILE = 5_000

interface StoredReceipt {
  name: string
  firstSeenAt: string
  lastSeenAt: string
}

interface StoredManualBlueprint {
  blueprintId: string
  blueprintKey: string
}

interface StoredOwnershipProfile {
  channel: string
  accountId: string
  handle: string | null
  receipts: Record<string, StoredReceipt>
  manualBlueprints: Record<string, StoredManualBlueprint>
}

interface OwnershipStore {
  schemaVersion: number
  profiles: Record<string, StoredOwnershipProfile>
}

interface LoadedOwnershipStore {
  store: OwnershipStore
  warning: string | null
  needsSave: boolean
  persistenceBlockedReason: string | null
}

interface ParsedOwnershipStore {
  store: OwnershipStore
  needsSave: boolean
}

interface ParsedOwnershipProfile {
  profile: StoredOwnershipProfile
  needsSave: boolean
}

interface OwnershipResolution {
  records: Record<string, BlueprintOwnershipRecord>
  ownedCount: number
  defaultCount: number
  logCount: number
  manualCount: number
  unresolvedReceiptNames: string[]
}

export interface BlueprintOwnershipServiceOptions {
  storePath: string
  onChange: () => void
  monitorIntervalMs?: number
}

function emptyStore(): OwnershipStore {
  return {
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    profiles: {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
  maxLength: number
): string | null {
  const candidate = value[key]
  return typeof candidate === 'string' &&
    candidate.trim().length > 0 &&
    candidate.length <= maxLength
    ? candidate.trim()
    : null
}

function readTimestamp(value: Record<string, unknown>, key: string): string | null {
  const candidate = readRequiredString(value, key, 100)
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null
}

function parseStoredReceipt(value: unknown): StoredReceipt | null {
  if (!isRecord(value)) return null
  const name = readRequiredString(value, 'name', 500)
  const firstSeenAt = readTimestamp(value, 'firstSeenAt')
  const lastSeenAt = readTimestamp(value, 'lastSeenAt')
  return name && firstSeenAt && lastSeenAt ? { name, firstSeenAt, lastSeenAt } : null
}

function parseManualBlueprint(value: unknown): StoredManualBlueprint | null {
  if (!isRecord(value)) return null
  const blueprintId = readRequiredString(value, 'blueprintId', 200)
  const blueprintKey = readRequiredString(value, 'blueprintKey', 500)
  return blueprintId && blueprintKey ? { blueprintId, blueprintKey } : null
}

function parseProfile(value: unknown): ParsedOwnershipProfile | null {
  if (!isRecord(value) || !isRecord(value.receipts) || !isRecord(value.manualBlueprints)) {
    return null
  }
  const channel = readRequiredString(value, 'channel', 100)
  const accountId = readRequiredString(value, 'accountId', 100)
  if (
    value.handle !== undefined &&
    value.handle !== null &&
    (typeof value.handle !== 'string' || value.handle.length > 200)
  ) {
    return null
  }
  const handle =
    typeof value.handle === 'string' && value.handle.trim().length > 0 ? value.handle.trim() : null
  const receiptEntries = Object.entries(value.receipts)
  const manualEntries = Object.entries(value.manualBlueprints)
  if (
    !channel ||
    !accountId ||
    receiptEntries.length > MAX_RECEIPTS_PER_PROFILE ||
    manualEntries.length > MAX_MANUAL_BLUEPRINTS_PER_PROFILE
  ) {
    return null
  }

  const receipts: Record<string, StoredReceipt> = {}
  let needsSave = false
  for (const [key, candidate] of receiptEntries) {
    const receipt = parseStoredReceipt(candidate)
    if (!receipt) {
      needsSave = true
      continue
    }
    const normalizedKey = normalizeBlueprintName(receipt.name)
    if (key !== normalizedKey) needsSave = true
    receipts[normalizedKey] = receipt
  }

  const manualBlueprints: Record<string, StoredManualBlueprint> = {}
  for (const [key, candidate] of manualEntries) {
    const blueprint = parseManualBlueprint(candidate)
    if (!blueprint) {
      needsSave = true
      continue
    }
    if (key !== blueprint.blueprintId) needsSave = true
    manualBlueprints[blueprint.blueprintId] = blueprint
  }

  return {
    profile: { channel, accountId, handle, receipts, manualBlueprints },
    needsSave
  }
}

function parseOwnershipStore(value: unknown): ParsedOwnershipStore {
  if (
    !isRecord(value) ||
    value.schemaVersion !== OWNERSHIP_SCHEMA_VERSION ||
    !isRecord(value.profiles)
  ) {
    throw new TypeError('The blueprint ownership file has an unsupported shape.')
  }
  const entries = Object.entries(value.profiles)
  if (entries.length > MAX_PROFILES) {
    throw new RangeError(`No more than ${MAX_PROFILES} blueprint profiles can be stored.`)
  }

  const profiles: Record<string, StoredOwnershipProfile> = {}
  let needsSave = false
  for (const [key, candidate] of entries) {
    const parsed = parseProfile(candidate)
    if (!parsed) {
      needsSave = true
      continue
    }
    const canonicalKey = profileKey(parsed.profile.channel, parsed.profile.accountId)
    if (key !== canonicalKey) needsSave = true
    const existing = profiles[canonicalKey]
    if (existing) {
      Object.assign(existing.receipts, parsed.profile.receipts)
      Object.assign(existing.manualBlueprints, parsed.profile.manualBlueprints)
      if (parsed.profile.handle) existing.handle = parsed.profile.handle
      needsSave = true
    } else {
      profiles[canonicalKey] = parsed.profile
    }
    needsSave = parsed.needsSave || needsSave
  }
  return {
    store: { schemaVersion: OWNERSHIP_SCHEMA_VERSION, profiles },
    needsSave
  }
}

export function parseBlueprintOwnershipStore(value: unknown): OwnershipStore {
  return parseOwnershipStore(value).store
}

async function loadOwnershipStore(path: string): Promise<LoadedOwnershipStore> {
  try {
    const parsed = parseOwnershipStore(JSON.parse(await fs.readFile(path, 'utf8')) as unknown)
    if (!parsed.needsSave) {
      return {
        store: parsed.store,
        warning: null,
        needsSave: false,
        persistenceBlockedReason: null
      }
    }
    const recovery = await createRecoveryCopy(path)
    return {
      store: parsed.store,
      warning: recovery.path
        ? `Blueprint ownership was repaired; the original file was preserved at ${recovery.path}.`
        : `Blueprint ownership needs repair, but its original file could not be preserved: ${recovery.error}`,
      needsSave: true,
      persistenceBlockedReason: recovery.path
        ? null
        : 'Blueprint ownership cannot be saved until its recovery copy succeeds.'
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        store: emptyStore(),
        warning: null,
        needsSave: false,
        persistenceBlockedReason: null
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    const recovery = await createRecoveryCopy(path)
    return {
      store: emptyStore(),
      warning: recovery.path
        ? `Saved blueprint ownership could not be loaded: ${message}. The original file was preserved at ${recovery.path}.`
        : `Saved blueprint ownership could not be loaded: ${message}. A recovery copy could not be created: ${recovery.error}`,
      needsSave: false,
      persistenceBlockedReason: recovery.path
        ? null
        : 'Blueprint ownership cannot be saved because its unreadable file could not be preserved.'
    }
  }
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

async function saveOwnershipStore(path: string, contents: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, contents, 'utf8')
    await fs.rename(temporaryPath, path)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}

function profileKey(channel: string, accountId: string): string {
  return `${channel.trim().toUpperCase()}:${accountId}`
}

function createProfile(
  channel: string,
  accountId: string,
  handle: string | null = null
): StoredOwnershipProfile {
  return {
    channel,
    accountId,
    handle,
    receipts: {},
    manualBlueprints: {}
  }
}

function addProfile(
  store: OwnershipStore,
  key: string,
  profile: StoredOwnershipProfile
): StoredOwnershipProfile {
  const existing = store.profiles[key]
  if (existing) return existing
  if (Object.keys(store.profiles).length >= MAX_PROFILES) {
    throw new RangeError(`No more than ${MAX_PROFILES} blueprint profiles can be stored.`)
  }
  store.profiles[key] = profile
  return profile
}

function mergeReceipt(profile: StoredOwnershipProfile, receipt: BlueprintLogReceipt): boolean {
  const key = receipt.normalizedName
  const receiptLastSeenAt = receipt.lastSeenAt ?? receipt.acquiredAt
  const existing = profile.receipts[key]
  if (!existing) {
    profile.receipts[key] = {
      name: receipt.name,
      firstSeenAt: receipt.acquiredAt,
      lastSeenAt: receiptLastSeenAt
    }
    return true
  }

  let changed = false
  if (receipt.acquiredAt < existing.firstSeenAt) {
    existing.firstSeenAt = receipt.acquiredAt
    existing.name = receipt.name
    changed = true
  }
  if (receiptLastSeenAt > existing.lastSeenAt) {
    existing.lastSeenAt = receiptLastSeenAt
    changed = true
  }
  return changed
}

export function resolveBlueprintOwnership(
  blueprints: readonly BlueprintSummary[],
  profile: StoredOwnershipProfile | null
): OwnershipResolution {
  const records: Record<string, BlueprintOwnershipRecord> = {}
  const byName = new Map<string, BlueprintSummary[]>()
  const byId = new Map(blueprints.map((blueprint) => [blueprint.id, blueprint]))
  const byKey = new Map<string, BlueprintSummary[]>()

  for (const blueprint of blueprints) {
    const nameKey = normalizeBlueprintName(blueprint.outputName)
    const nameMatches = byName.get(nameKey) ?? []
    nameMatches.push(blueprint)
    byName.set(nameKey, nameMatches)

    const keyMatches = byKey.get(blueprint.key) ?? []
    keyMatches.push(blueprint)
    byKey.set(blueprint.key, keyMatches)

    if (blueprint.availableByDefault) {
      records[blueprint.id] = {
        blueprintId: blueprint.id,
        source: 'default',
        acquiredAt: null
      }
    }
  }

  const unresolvedReceipts: StoredReceipt[] = []
  const manuallyResolvedNames = new Set<string>()
  if (profile) {
    for (const receipt of Object.values(profile.receipts)) {
      let matches: BlueprintSummary[] = []
      for (const candidate of blueprintNameCandidates(receipt.name)) {
        const candidateMatches = byName.get(candidate) ?? []
        if (candidateMatches.length > 0) {
          matches = candidateMatches
          break
        }
      }
      if (matches.length !== 1) {
        unresolvedReceipts.push(receipt)
        continue
      }

      const blueprint = matches[0]
      if (!records[blueprint.id]) {
        records[blueprint.id] = {
          blueprintId: blueprint.id,
          source: 'log',
          acquiredAt: receipt.firstSeenAt
        }
      }
    }

    for (const manual of Object.values(profile.manualBlueprints)) {
      const direct = byId.get(manual.blueprintId)
      const keyMatches = byKey.get(manual.blueprintKey) ?? []
      const blueprint = direct ?? (keyMatches.length === 1 ? keyMatches[0] : null)
      if (blueprint && !records[blueprint.id]) {
        records[blueprint.id] = {
          blueprintId: blueprint.id,
          source: 'manual',
          acquiredAt: null
        }
      }
      if (blueprint) manuallyResolvedNames.add(normalizeBlueprintName(blueprint.outputName))
    }
  }

  const unresolvedReceiptNames = unresolvedReceipts
    .filter(
      (receipt) =>
        !blueprintNameCandidates(receipt.name).some((candidate) =>
          manuallyResolvedNames.has(candidate)
        )
    )
    .map((receipt) => receipt.name)
  const ownershipRecords = Object.values(records)
  return {
    records,
    ownedCount: ownershipRecords.length,
    defaultCount: ownershipRecords.filter((record) => record.source === 'default').length,
    logCount: ownershipRecords.filter((record) => record.source === 'log').length,
    manualCount: ownershipRecords.filter((record) => record.source === 'manual').length,
    unresolvedReceiptNames: [...new Set(unresolvedReceiptNames)].sort((left, right) =>
      left.localeCompare(right)
    )
  }
}

export class BlueprintOwnershipService {
  private readonly storePath: string
  private readonly onChange: () => void
  private readonly monitorIntervalMs: number | undefined
  private store: OwnershipStore = emptyStore()
  private loadWarning: string | null = null
  private channel: string | null = null
  private channelDirectory: string | null = null
  private activeIdentity: BlueprintLogIdentity | null = null
  private status: BlueprintOwnershipStatus = 'unavailable'
  private statusError: string | null = null
  private filesScanned = 0
  private filesSkipped = 0
  private unassignedReceiptCount = 0
  private readonly unassignedLiveReceiptNames = new Set<string>()
  private earliestLogAt: string | null = null
  private lastScanAt: string | null = null
  private monitor: BlueprintLogMonitor | null = null
  private generation = 0
  private pendingScan: { generation: number; request: Promise<void> } | null = null
  private scanQueued = false
  private saveQueue: Promise<void> = Promise.resolve()
  private storeRevision = 0
  private persistedRevision = 0
  private persistenceBlockedReason: string | null = null

  constructor(options: BlueprintOwnershipServiceOptions) {
    this.storePath = options.storePath
    this.onChange = options.onChange
    this.monitorIntervalMs = options.monitorIntervalMs
  }

  async initialize(): Promise<void> {
    const loaded = await loadOwnershipStore(this.storePath)
    this.store = loaded.store
    this.loadWarning = loaded.warning
    this.persistenceBlockedReason = loaded.persistenceBlockedReason
    if (loaded.needsSave) this.markDirty()
  }

  async configure(archive: GameDataArchive | null): Promise<void> {
    this.generation += 1
    this.monitor?.stop()
    this.monitor = null
    this.pendingScan = null
    this.scanQueued = false
    this.channel = archive?.channel ?? null
    this.channelDirectory = archive ? dirname(archive.path) : null
    this.activeIdentity = null
    this.filesScanned = 0
    this.filesSkipped = 0
    this.unassignedReceiptCount = 0
    this.unassignedLiveReceiptNames.clear()
    this.earliestLogAt = null
    this.lastScanAt = null
    this.statusError = null

    if (!this.channelDirectory || !this.channel) {
      this.status = 'unavailable'
      this.emitChange()
      return
    }

    const generation = this.generation
    this.status = 'scanning'
    this.emitChange()
    try {
      await this.startMonitor(generation)
      await this.rescan()
    } catch (reason) {
      if (generation !== this.generation) return
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.status = 'error'
      this.statusError =
        this.statusError ?? `Blueprint log monitoring could not start: ${error.message}`
      this.emitChange()
      throw reason
    }
  }

  private async startMonitor(generation: number): Promise<void> {
    const channelDirectory = this.channelDirectory
    if (!channelDirectory) return
    const monitor = new BlueprintLogMonitor({
      intervalMs: this.monitorIntervalMs,
      onReceipts: async (receipts) => {
        if (generation !== this.generation) return
        await this.importLiveReceipts(receipts)
      },
      onIdentity: async (identity) => {
        if (generation !== this.generation) return
        await this.activateIdentity(identity)
      },
      onRotation: async () => {
        if (generation !== this.generation) return
        await this.rescan(true)
      },
      onError: (error) => {
        if (generation !== this.generation) return
        this.status = 'error'
        this.statusError = `Blueprint log monitoring failed: ${error.message}`
        this.emitChange()
      }
    })
    this.monitor = monitor
    try {
      await monitor.start(channelDirectory)
    } catch (error) {
      monitor.stop()
      if (this.monitor === monitor) this.monitor = null
      throw error
    }
  }

  async rescan(queueAfterPending = false): Promise<void> {
    if (!this.channelDirectory || !this.channel) {
      this.status = 'unavailable'
      this.emitChange()
      return
    }
    const generation = this.generation
    if (!this.monitor) {
      this.status = 'scanning'
      this.statusError = null
      this.emitChange()
      try {
        await this.startMonitor(generation)
      } catch (reason) {
        if (generation !== this.generation) return
        const error = reason instanceof Error ? reason : new Error(String(reason))
        this.status = 'error'
        this.statusError = `Blueprint log monitoring could not start: ${error.message}`
        this.emitChange()
        throw error
      }
    }
    if (this.pendingScan?.generation === generation) {
      if (queueAfterPending) this.scanQueued = true
      return this.pendingScan.request
    }

    const request = this.runScans(generation)
    const pending = { generation, request }
    this.pendingScan = pending
    try {
      await request
    } finally {
      if (this.pendingScan === pending) this.pendingScan = null
    }
  }

  private async runScans(generation: number): Promise<void> {
    do {
      this.scanQueued = false
      await this.performScan(generation)
    } while (generation === this.generation && this.scanQueued)
  }

  getSnapshot(blueprints: readonly BlueprintSummary[]): BlueprintOwnershipSnapshot {
    const resolution = resolveBlueprintOwnership(blueprints, this.getActiveProfile())
    const unresolvedCount = resolution.unresolvedReceiptNames.length
    const statusMessage =
      this.status === 'scanning'
        ? `Scanning ${this.channel ?? 'game'} blueprint receipts…`
        : this.status === 'watching'
          ? this.filesScanned > 0
            ? `Monitoring ${this.channel} Game.log · ${this.filesScanned} log file${
                this.filesScanned === 1 ? '' : 's'
              } scanned`
            : `Waiting for ${this.channel} Game.log`
          : this.status === 'error'
            ? (this.statusError ?? 'Blueprint log monitoring failed.')
            : 'Choose Game files to monitor blueprint receipts.'
    const message = [
      statusMessage,
      this.filesSkipped > 0
        ? `${this.filesSkipped} log file${this.filesSkipped === 1 ? '' : 's'} could not be read`
        : null,
      this.unassignedReceiptCount > 0
        ? `${this.unassignedReceiptCount} receipt${
            this.unassignedReceiptCount === 1 ? '' : 's'
          } could not be assigned to an account`
        : null,
      unresolvedCount > 0
        ? `${unresolvedCount} receipt${unresolvedCount === 1 ? '' : 's'} need manual matching`
        : null,
      this.loadWarning
    ]
      .filter(Boolean)
      .join('. ')

    return {
      ...resolution,
      status: this.status,
      channel: this.channel,
      message,
      warning: this.loadWarning,
      filesScanned: this.filesScanned,
      filesSkipped: this.filesSkipped,
      unassignedReceiptCount: this.unassignedReceiptCount,
      earliestLogAt: this.earliestLogAt,
      lastScanAt: this.lastScanAt
    }
  }

  async setManualOwned(blueprint: BlueprintSummary, owned: boolean): Promise<void> {
    const profile = this.getOrCreateActiveProfile()
    if (owned) {
      profile.manualBlueprints[blueprint.id] = {
        blueprintId: blueprint.id,
        blueprintKey: blueprint.key
      }
    } else {
      for (const [id, manual] of Object.entries(profile.manualBlueprints)) {
        if (id === blueprint.id || manual.blueprintKey === blueprint.key) {
          delete profile.manualBlueprints[id]
        }
      }
    }
    this.markDirty()
    await this.persist()
    this.emitChange()
  }

  dispose(): void {
    this.generation += 1
    this.monitor?.stop()
    this.monitor = null
  }

  private async performScan(generation: number): Promise<void> {
    const channelDirectory = this.channelDirectory
    if (!channelDirectory) return
    this.status = 'scanning'
    this.statusError = null
    this.emitChange()

    try {
      const result = await scanBlueprintLogs(channelDirectory)
      if (generation !== this.generation) return
      let changed = this.mergeScan(result)
      this.activeIdentity = result.activeIdentity
      if (this.activeIdentity) {
        changed = this.migrateManualProfile(this.activeIdentity) || changed
      }
      this.monitor?.setFallbackIdentity(this.activeIdentity)
      this.filesScanned = result.filesScanned
      this.filesSkipped = result.filesSkipped
      if (this.activeIdentity && result.unassignedReceiptCount === 0) {
        this.unassignedLiveReceiptNames.clear()
        this.unassignedReceiptCount = 0
      } else {
        this.unassignedReceiptCount = Math.max(
          result.unassignedReceiptCount,
          this.unassignedLiveReceiptNames.size
        )
      }
      this.earliestLogAt = result.earliestLogAt
      this.lastScanAt = new Date().toISOString()
      this.status = 'watching'
      if (changed) this.markDirty()
      if (this.hasPendingChanges()) await this.persist()
      this.emitChange()
    } catch (reason) {
      if (generation !== this.generation) return
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.status = 'error'
      this.statusError = `Blueprint log scan failed: ${error.message}`
      this.emitChange()
      throw error
    }
  }

  private mergeScan(result: BlueprintLogScanResult): boolean {
    const channel = this.channel
    if (!channel) return false
    let changed = false
    for (const scannedProfile of result.profiles) {
      const key = profileKey(channel, scannedProfile.accountId)
      const existing = this.store.profiles[key]
      const profile = addProfile(
        this.store,
        key,
        createProfile(channel, scannedProfile.accountId, scannedProfile.handle)
      )
      if (!existing) {
        changed = true
      }
      if (scannedProfile.handle && scannedProfile.handle !== profile.handle) {
        profile.handle = scannedProfile.handle
        changed = true
      }
      for (const receipt of scannedProfile.receipts) {
        changed = mergeReceipt(profile, receipt) || changed
      }
    }
    return changed
  }

  private async importLiveReceipts(receipts: BlueprintLogReceipt[]): Promise<void> {
    const channel = this.channel
    if (!channel) return
    let changed = false
    let stateChanged = false
    for (const receipt of receipts) {
      const accountId = receipt.accountId
      if (!accountId) {
        if (!this.unassignedLiveReceiptNames.has(receipt.normalizedName)) {
          this.unassignedLiveReceiptNames.add(receipt.normalizedName)
          this.unassignedReceiptCount += 1
          stateChanged = true
        }
        continue
      }
      if (this.unassignedLiveReceiptNames.delete(receipt.normalizedName)) {
        this.unassignedReceiptCount = Math.max(this.unassignedReceiptCount - 1, 0)
        stateChanged = true
      }
      const key = profileKey(channel, accountId)
      const existing = this.store.profiles[key]
      const profile = addProfile(
        this.store,
        key,
        createProfile(channel, accountId, receipt.handle ?? null)
      )
      if (!existing) {
        changed = true
      }
      if (receipt.handle && receipt.handle !== profile.handle) {
        profile.handle = receipt.handle
        changed = true
      }
      changed = mergeReceipt(profile, receipt) || changed
    }
    const recovered = this.status === 'error'
    this.status = 'watching'
    this.statusError = null
    if (!changed) {
      if (this.hasPendingChanges()) await this.persist()
      if (recovered || stateChanged) this.emitChange()
      return
    }
    if (this.activeIdentity) {
      changed = this.migrateManualProfile(this.activeIdentity) || changed
    }
    if (changed) this.markDirty()
    await this.persist()
    this.emitChange()
  }

  private getActiveProfile(): StoredOwnershipProfile | null {
    const channel = this.channel
    if (!channel) {
      return this.store.profiles[profileKey(CACHED_CHANNEL, MANUAL_ACCOUNT)] ?? null
    }
    if (this.activeIdentity) {
      return this.store.profiles[profileKey(channel, this.activeIdentity.accountId)] ?? null
    }
    if (this.status === 'scanning') {
      return this.store.profiles[profileKey(channel, MANUAL_ACCOUNT)] ?? null
    }

    const profiles = Object.values(this.store.profiles).filter(
      (profile) => profile.channel.toUpperCase() === channel.toUpperCase()
    )
    const nonManualProfiles = profiles.filter((profile) => profile.accountId !== MANUAL_ACCOUNT)
    if (nonManualProfiles.length === 1) return nonManualProfiles[0]
    return (
      this.store.profiles[profileKey(channel, MANUAL_ACCOUNT)] ??
      (profiles.length === 1 ? profiles[0] : null)
    )
  }

  private getOrCreateActiveProfile(): StoredOwnershipProfile {
    const existing = this.getActiveProfile()
    if (existing) return existing
    const channel = this.channel ?? CACHED_CHANNEL
    const accountId = this.activeIdentity?.accountId ?? MANUAL_ACCOUNT
    const key = profileKey(channel, accountId)
    return addProfile(
      this.store,
      key,
      createProfile(channel, accountId, this.activeIdentity?.handle ?? null)
    )
  }

  private migrateManualProfile(identity: BlueprintLogIdentity): boolean {
    const channel = this.channel
    if (!channel) return false
    const targetKey = profileKey(channel, identity.accountId)
    const existingTarget = this.store.profiles[targetKey]
    const target = addProfile(
      this.store,
      targetKey,
      createProfile(channel, identity.accountId, identity.handle)
    )
    let changed = !existingTarget

    for (const sourceKey of [
      profileKey(channel, MANUAL_ACCOUNT),
      profileKey(CACHED_CHANNEL, MANUAL_ACCOUNT)
    ]) {
      const source = this.store.profiles[sourceKey]
      if (!source || source === target) continue
      for (const manual of Object.values(source.manualBlueprints)) {
        if (!target.manualBlueprints[manual.blueprintId]) {
          target.manualBlueprints[manual.blueprintId] = manual
          changed = true
        }
      }
      if (Object.keys(source.receipts).length === 0) {
        delete this.store.profiles[sourceKey]
        changed = true
      } else if (Object.keys(source.manualBlueprints).length > 0) {
        source.manualBlueprints = {}
        changed = true
      }
    }
    return changed
  }

  private async activateIdentity(identity: BlueprintLogIdentity): Promise<void> {
    const channel = this.channel
    if (!channel) return
    const identityChanged =
      identity.accountId !== this.activeIdentity?.accountId ||
      identity.handle !== this.activeIdentity?.handle
    this.activeIdentity = identity
    this.monitor?.setFallbackIdentity(identity)
    const key = profileKey(channel, identity.accountId)
    const existing = this.store.profiles[key]
    addProfile(this.store, key, createProfile(channel, identity.accountId, identity.handle))
    const migrated = this.migrateManualProfile(identity)
    const changed = !existing || migrated
    if (changed) {
      this.markDirty()
      await this.persist()
    }
    if (identityChanged || changed) this.emitChange()
  }

  private async persist(): Promise<void> {
    if (this.persistenceBlockedReason) {
      throw new Error(this.persistenceBlockedReason)
    }
    if (!this.hasPendingChanges()) return
    const revision = this.storeRevision
    const contents = `${JSON.stringify(this.store, null, 2)}\n`
    const queued = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await saveOwnershipStore(this.storePath, contents)
        this.persistedRevision = Math.max(this.persistedRevision, revision)
      })
    this.saveQueue = queued
    await queued
  }

  private markDirty(): void {
    this.storeRevision += 1
  }

  private hasPendingChanges(): boolean {
    return this.storeRevision > this.persistedRevision
  }

  private emitChange(): void {
    this.onChange()
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
