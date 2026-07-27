import { createReadStream, promises as fs, unwatchFile, watchFile } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { StringDecoder } from 'node:string_decoder'

const LIVE_LOG_NAME = 'Game.log'
const LOG_BACKUP_DIRECTORY = 'logbackups'
const UNASSIGNED_ACCOUNT = 'unassigned'
const MAX_BLUEPRINT_NAME_LENGTH = 500
const MAX_HANDLE_LENGTH = 200
const LOG_PREFIX_BYTES = 256
const STAR_STRINGS_PREFIX = /^[A-Za-z]+\/\d{1,2}\/[A-Za-z]+\s+/
const TIMESTAMP_PATTERN = /^<(?<timestamp>[^>]+)>/
const BLUEPRINT_RECEIPT_PATTERN =
  /^<(?<timestamp>[^>]+)>.*?<SHUDEvent_OnNotification> Added notification "Received Blueprint:\s*(?<name>.*?):\s*"\s+\[/
const ACCOUNT_PATTERN =
  /<AccountLoginCharacterStatus_Character>.*?\baccountId (?<accountId>\d+)\s+-\s+name (?<handle>.+?)\s+-\s+state STATE_CURRENT\b/

export interface BlueprintLogIdentity {
  accountId: string
  handle: string | null
}

export interface BlueprintLogReceipt {
  accountId: string | null
  handle: string | null
  name: string
  normalizedName: string
  acquiredAt: string
  lastSeenAt?: string
}

export interface BlueprintLogProfileScan {
  accountId: string
  handle: string | null
  receipts: BlueprintLogReceipt[]
}

export interface BlueprintLogScanResult {
  profiles: BlueprintLogProfileScan[]
  activeIdentity: BlueprintLogIdentity | null
  filesScanned: number
  filesSkipped: number
  unassignedReceiptCount: number
  earliestLogAt: string | null
  latestLogAt: string | null
}

interface MutableProfileScan {
  accountId: string
  handle: string | null
  receipts: Map<string, BlueprintLogReceipt>
}

interface LogFileCandidate {
  path: string
  modifiedAt: number
  live: boolean
}

export function normalizeBlueprintName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function blueprintNameCandidates(value: string): string[] {
  const exact = normalizeBlueprintName(value)
  const withoutStarStringsPrefix = normalizeBlueprintName(value.replace(STAR_STRINGS_PREFIX, ''))
  return exact === withoutStarStringsPrefix ? [exact] : [exact, withoutStarStringsPrefix]
}

export function parseBlueprintReceiptLine(
  line: string
): Omit<BlueprintLogReceipt, 'accountId' | 'handle'> | null {
  const match = BLUEPRINT_RECEIPT_PATTERN.exec(line)
  const acquiredAt = match?.groups?.timestamp
  const name = match?.groups?.name.trim()
  if (
    !acquiredAt ||
    !name ||
    name.length > MAX_BLUEPRINT_NAME_LENGTH ||
    !Number.isFinite(Date.parse(acquiredAt))
  ) {
    return null
  }

  return {
    name,
    normalizedName: normalizeBlueprintName(name),
    acquiredAt
  }
}

export function parseBlueprintLogIdentity(line: string): BlueprintLogIdentity | null {
  const match = ACCOUNT_PATTERN.exec(line)
  const accountId = match?.groups?.accountId
  const handle = match?.groups?.handle.trim()
  if (!accountId || !handle || handle.length > MAX_HANDLE_LENGTH) return null
  return { accountId, handle }
}

function parseTimestamp(line: string): string | null {
  const timestamp = TIMESTAMP_PATTERN.exec(line)?.groups?.timestamp
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null
}

function updateTimestampBounds(
  timestamp: string | null,
  current: { earliest: string | null; latest: string | null }
): void {
  if (!timestamp) return
  if (current.earliest === null || timestamp < current.earliest) current.earliest = timestamp
  if (current.latest === null || timestamp > current.latest) current.latest = timestamp
}

async function findLogFiles(channelDirectory: string): Promise<LogFileCandidate[]> {
  const candidates: LogFileCandidate[] = []
  const livePath = join(channelDirectory, LIVE_LOG_NAME)
  try {
    const stats = await fs.stat(livePath)
    if (stats.isFile()) candidates.push({ path: livePath, modifiedAt: stats.mtimeMs, live: true })
  } catch (error) {
    if (!isMissingFileError(error)) throw error
  }

  const backupDirectory = join(channelDirectory, LOG_BACKUP_DIRECTORY)
  try {
    const entries = await fs.readdir(backupDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) continue
      const path = join(backupDirectory, entry.name)
      try {
        const stats = await fs.stat(path)
        candidates.push({ path, modifiedAt: stats.mtimeMs, live: false })
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error
  }

  return candidates.sort(
    (left, right) =>
      Number(left.live) - Number(right.live) ||
      left.modifiedAt - right.modifiedAt ||
      left.path.localeCompare(right.path)
  )
}

function getProfile(
  profiles: Map<string, MutableProfileScan>,
  identity: BlueprintLogIdentity | null
): MutableProfileScan {
  const accountId = identity?.accountId ?? UNASSIGNED_ACCOUNT
  const existing = profiles.get(accountId)
  if (existing) {
    if (identity?.handle) existing.handle = identity.handle
    return existing
  }

  const profile: MutableProfileScan = {
    accountId,
    handle: identity?.handle ?? null,
    receipts: new Map()
  }
  profiles.set(accountId, profile)
  return profile
}

function mergeReceipt(profile: MutableProfileScan, receipt: BlueprintLogReceipt): void {
  const existing = profile.receipts.get(receipt.normalizedName)
  if (!existing) {
    profile.receipts.set(receipt.normalizedName, {
      ...receipt,
      lastSeenAt: receipt.lastSeenAt ?? receipt.acquiredAt
    })
    return
  }

  const firstSeenAt =
    receipt.acquiredAt < existing.acquiredAt ? receipt.acquiredAt : existing.acquiredAt
  const existingLastSeenAt = existing.lastSeenAt ?? existing.acquiredAt
  const receiptLastSeenAt = receipt.lastSeenAt ?? receipt.acquiredAt
  const lastSeenAt = receiptLastSeenAt > existingLastSeenAt ? receiptLastSeenAt : existingLastSeenAt
  profile.receipts.set(receipt.normalizedName, {
    ...(firstSeenAt === receipt.acquiredAt ? receipt : existing),
    acquiredAt: firstSeenAt,
    lastSeenAt
  })
}

export async function scanBlueprintLogs(channelDirectory: string): Promise<BlueprintLogScanResult> {
  const candidates = await findLogFiles(channelDirectory)
  const profiles = new Map<string, MutableProfileScan>()
  const bounds = { earliest: null as string | null, latest: null as string | null }
  let filesScanned = 0
  let filesSkipped = 0
  let activeIdentity: BlueprintLogIdentity | null = null
  let latestIdentity: { identity: BlueprintLogIdentity; timestamp: string | null } | null = null

  for (const candidate of candidates) {
    let currentIdentity: BlueprintLogIdentity | null = null
    try {
      const lines = createInterface({
        input: createReadStream(candidate.path, { encoding: 'utf8' }),
        crlfDelay: Number.POSITIVE_INFINITY
      })
      for await (const line of lines) {
        const timestamp = parseTimestamp(line)
        updateTimestampBounds(timestamp, bounds)

        const identity = parseBlueprintLogIdentity(line)
        if (identity) {
          currentIdentity = identity
          getProfile(profiles, identity)
          if (
            !latestIdentity ||
            (timestamp !== null &&
              (latestIdentity.timestamp === null || timestamp > latestIdentity.timestamp))
          ) {
            latestIdentity = { identity, timestamp }
          }
          if (candidate.live) activeIdentity = identity
        }

        if (!line.includes('Received Blueprint:')) continue
        const parsed = parseBlueprintReceiptLine(line)
        if (!parsed) continue
        const receipt: BlueprintLogReceipt = {
          ...parsed,
          accountId: currentIdentity?.accountId ?? null,
          handle: currentIdentity?.handle ?? null
        }
        mergeReceipt(getProfile(profiles, currentIdentity), receipt)
      }
      filesScanned += 1
    } catch {
      filesSkipped += 1
    }
  }

  const unassignedReceiptCount = profiles.get(UNASSIGNED_ACCOUNT)?.receipts.size ?? 0
  profiles.delete(UNASSIGNED_ACCOUNT)

  activeIdentity ??= latestIdentity?.identity ?? null
  return {
    profiles: [...profiles.values()].map((profile) => ({
      accountId: profile.accountId,
      handle: profile.handle,
      receipts: [...profile.receipts.values()].sort(
        (left, right) =>
          left.acquiredAt.localeCompare(right.acquiredAt) || left.name.localeCompare(right.name)
      )
    })),
    activeIdentity,
    filesScanned,
    filesSkipped,
    unassignedReceiptCount,
    earliestLogAt: bounds.earliest,
    latestLogAt: bounds.latest
  }
}

export interface BlueprintLogMonitorOptions {
  intervalMs?: number
  onReceipts: (receipts: BlueprintLogReceipt[]) => void | Promise<void>
  onIdentity?: (identity: BlueprintLogIdentity) => void | Promise<void>
  onRotation?: () => void | Promise<void>
  onError: (error: Error) => void
}

export class BlueprintLogMonitor {
  private readonly intervalMs: number
  private readonly onReceipts: BlueprintLogMonitorOptions['onReceipts']
  private readonly onIdentity: BlueprintLogMonitorOptions['onIdentity']
  private readonly onRotation: BlueprintLogMonitorOptions['onRotation']
  private readonly onError: BlueprintLogMonitorOptions['onError']
  private logPath: string | null = null
  private offset = 0
  private partialLine = ''
  private prefix: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private decoder = new StringDecoder('utf8')
  private identity: BlueprintLogIdentity | null = null
  private fallbackIdentity: BlueprintLogIdentity | null = null
  private readQueue: Promise<void> = Promise.resolve()
  private generation = 0

  constructor(options: BlueprintLogMonitorOptions) {
    this.intervalMs = options.intervalMs ?? 1_000
    this.onReceipts = options.onReceipts
    this.onIdentity = options.onIdentity
    this.onRotation = options.onRotation
    this.onError = options.onError
  }

  async start(channelDirectory: string): Promise<void> {
    this.stop()
    const generation = this.generation
    this.logPath = join(channelDirectory, LIVE_LOG_NAME)
    try {
      const stats = await fs.stat(this.logPath)
      this.offset = stats.size
      this.prefix = await readFilePrefix(this.logPath, Math.min(stats.size, LOG_PREFIX_BYTES))
    } catch (error) {
      if (!isMissingFileError(error)) throw error
      this.offset = 0
      this.prefix = Buffer.alloc(0)
    }

    watchFile(
      this.logPath,
      { interval: this.intervalMs, persistent: false },
      (current, previous) => {
        if (generation !== this.generation || !this.logPath) return
        const replaced =
          current.size < this.offset ||
          (current.ino !== 0 && previous.ino !== 0 && current.ino !== previous.ino) ||
          (previous.birthtimeMs > 0 && current.birthtimeMs !== previous.birthtimeMs)
        this.queueRead(replaced)
      }
    )
  }

  setFallbackIdentity(identity: BlueprintLogIdentity | null): void {
    this.fallbackIdentity = identity
  }

  stop(): void {
    this.generation += 1
    if (this.logPath) unwatchFile(this.logPath)
    this.logPath = null
    this.offset = 0
    this.partialLine = ''
    this.prefix = Buffer.alloc(0)
    this.decoder = new StringDecoder('utf8')
    this.identity = null
    this.fallbackIdentity = null
    this.readQueue = Promise.resolve()
  }

  private queueRead(reset: boolean): void {
    const generation = this.generation
    this.readQueue = this.readQueue
      .then(async () => {
        if (generation !== this.generation) return
        const rotated = await this.readChanges(reset)
        if (rotated) await this.onRotation?.()
      })
      .catch((reason: unknown) => {
        this.onError(reason instanceof Error ? reason : new Error(String(reason)))
      })
  }

  private async readChanges(reset: boolean): Promise<boolean> {
    const path = this.logPath
    if (!path) return false
    let size: number
    try {
      size = (await fs.stat(path)).size
    } catch (error) {
      if (isMissingFileError(error)) return false
      throw error
    }

    const prefixChanged =
      this.prefix.length > 0 &&
      (size < this.prefix.length ||
        !(await readFilePrefix(path, this.prefix.length)).equals(this.prefix))
    const resetFile = reset || prefixChanged || size < this.offset
    if (resetFile) {
      this.offset = 0
      this.partialLine = ''
      this.identity = null
      this.decoder = new StringDecoder('utf8')
    }
    if (size <= this.offset) return resetFile

    const start = this.offset
    const chunks: Buffer[] = []
    for await (const chunk of createReadStream(path, { start, end: size - 1 })) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    this.offset = size
    if (resetFile || this.prefix.length === 0) {
      this.prefix = await readFilePrefix(path, Math.min(size, LOG_PREFIX_BYTES))
    }
    const text = this.partialLine + this.decoder.write(Buffer.concat(chunks))
    const lines = text.split(/\r?\n/)
    this.partialLine = lines.pop() ?? ''
    const receipts: BlueprintLogReceipt[] = []

    for (const line of lines) {
      const identity = parseBlueprintLogIdentity(line)
      if (identity) {
        const changed =
          identity.accountId !== this.identity?.accountId ||
          identity.handle !== this.identity?.handle
        this.identity = identity
        if (changed && this.onIdentity) {
          try {
            await this.onIdentity(identity)
          } catch (reason) {
            this.onError(reason instanceof Error ? reason : new Error(String(reason)))
          }
        }
      }
      if (!line.includes('Received Blueprint:')) continue
      const parsed = parseBlueprintReceiptLine(line)
      if (!parsed) continue
      const effectiveIdentity = this.identity ?? this.fallbackIdentity
      receipts.push({
        ...parsed,
        accountId: effectiveIdentity?.accountId ?? null,
        handle: effectiveIdentity?.handle ?? null
      })
    }
    if (receipts.length > 0) await this.onReceipts(receipts)
    return resetFile
  }
}

async function readFilePrefix(path: string, length: number): Promise<Buffer<ArrayBufferLike>> {
  if (length <= 0) return Buffer.alloc(0)
  const handle = await fs.open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
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
