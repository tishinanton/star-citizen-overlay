import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  X509Certificate
} from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

import { generate } from 'selfsigned'

import {
  MAX_LAN_PAIRED_CLIENTS,
  type LanPairedClientSummary,
  type LanPairingRequestV1
} from '../shared/lan-control'

const LAN_CONTROL_STORE_VERSION = 1
const TOKEN_BYTES = 32
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface LanSecretProtector {
  isEncryptionAvailable: () => boolean
  encrypt: (value: string) => string
  decrypt: (value: string) => string
}

export interface LanCertificateMaterial {
  certificatePem: string
  privateKeyPem: string
}

interface LanClientRecord extends LanPairedClientSummary {
  tokenHash: string
}

interface LanControlStoreData {
  schemaVersion: typeof LAN_CONTROL_STORE_VERSION
  serverId: string
  certificatePem: string
  encryptedPrivateKey: string
  clients: LanClientRecord[]
}

export interface LanTlsIdentity {
  serverId: string
  certificatePem: string
  privateKeyPem: string
  tlsSpkiSha256: string
  verificationCode: string
}

export interface LanIssuedCredential {
  client: LanPairedClientSummary
  accessToken: string
}

export class LanControlStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LanControlStoreError'
  }
}

export class LanClientCapacityError extends Error {
  constructor() {
    super(`No more than ${MAX_LAN_PAIRED_CLIENTS} devices can be paired.`)
    this.name = 'LanClientCapacityError'
  }
}

export interface LanControlStoreOptions {
  path: string
  protector: LanSecretProtector
  generateCertificate?: (serverId: string) => Promise<LanCertificateMaterial>
}

export class LanControlStore {
  private readonly path: string
  private readonly protector: LanSecretProtector
  private readonly generateCertificate: (serverId: string) => Promise<LanCertificateMaterial>
  private data: LanControlStoreData | null = null
  private tlsIdentity: LanTlsIdentity | null = null
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(options: LanControlStoreOptions) {
    this.path = options.path
    this.protector = options.protector
    this.generateCertificate = options.generateCertificate ?? generateLanCertificate
  }

  async initialize(): Promise<LanTlsIdentity> {
    const identity = await this.initializeInternal(true)
    if (!identity) throw new LanControlStoreError('LAN identity could not be created.')
    return identity
  }

  initializeExisting(): Promise<LanTlsIdentity | null> {
    return this.initializeInternal(false)
  }

  private async initializeInternal(createIfMissing: boolean): Promise<LanTlsIdentity | null> {
    if (this.tlsIdentity) return this.tlsIdentity
    if (!this.protector.isEncryptionAvailable()) {
      throw new LanControlStoreError(
        'Windows protected storage is unavailable, so LAN control cannot protect its TLS key.'
      )
    }

    let data: LanControlStoreData
    try {
      const contents = await fs.readFile(this.path, 'utf8')
      data = parseLanControlStore(JSON.parse(contents) as unknown)
    } catch (error) {
      if (isMissingFileError(error)) {
        if (!createIfMissing) return null
        data = await this.createStoreData()
        await saveLanControlStore(this.path, data)
      } else {
        const recovery = await createRecoveryCopy(this.path)
        const message = error instanceof Error ? error.message : String(error)
        throw new LanControlStoreError(
          recovery.path
            ? `Saved LAN identity could not be loaded: ${message}. The original file was preserved at ${recovery.path}.`
            : `Saved LAN identity could not be loaded: ${message}. A recovery copy could not be created: ${recovery.error}`,
          { cause: error }
        )
      }
    }

    const identity = hydrateTlsIdentity(data, this.protector)
    this.data = data
    this.tlsIdentity = identity
    return identity
  }

  getIdentity(): LanTlsIdentity {
    if (!this.tlsIdentity) throw new LanControlStoreError('LAN identity is not initialized.')
    return this.tlsIdentity
  }

  getClients(): LanPairedClientSummary[] {
    return this.requireData().clients.map(({ id, name, appVersion, pairedAt }) => ({
      id,
      name,
      appVersion,
      pairedAt
    }))
  }

  authenticate(accessToken: string): LanPairedClientSummary | null {
    if (!accessToken || accessToken.length > 200) return null
    const suppliedHash = hashToken(accessToken)
    for (const { tokenHash, ...client } of this.requireData().clients) {
      if (safeHashEquals(tokenHash, suppliedHash)) return { ...client }
    }
    return null
  }

  pairClient(request: LanPairingRequestV1): Promise<LanIssuedCredential> {
    return this.enqueue(async () => {
      const data = this.requireData()
      if (data.clients.length >= MAX_LAN_PAIRED_CLIENTS) throw new LanClientCapacityError()
      const accessToken = randomBytes(TOKEN_BYTES).toString('base64url')
      const client: LanPairedClientSummary = {
        id: randomUUID(),
        name: request.client.name,
        appVersion: request.client.appVersion,
        pairedAt: new Date().toISOString()
      }
      const next: LanControlStoreData = {
        ...data,
        clients: [...data.clients, { ...client, tokenHash: hashToken(accessToken) }]
      }
      await saveLanControlStore(this.path, next)
      this.data = next
      return { client, accessToken }
    })
  }

  revokeClient(clientId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const data = this.requireData()
      const clients = data.clients.filter((client) => client.id !== clientId)
      if (clients.length === data.clients.length) return false
      const next = { ...data, clients }
      await saveLanControlStore(this.path, next)
      this.data = next
      return true
    })
  }

  reset(): Promise<LanTlsIdentity> {
    return this.enqueue(async () => {
      if (!this.protector.isEncryptionAvailable()) {
        throw new LanControlStoreError(
          'Windows protected storage is unavailable, so LAN control cannot protect its TLS key.'
        )
      }
      const data = await this.createStoreData()
      await saveLanControlStore(this.path, data)
      const identity = hydrateTlsIdentity(data, this.protector)
      this.data = data
      this.tlsIdentity = identity
      return identity
    })
  }

  private async createStoreData(): Promise<LanControlStoreData> {
    const serverId = randomUUID()
    const material = await this.generateCertificate(serverId)
    return {
      schemaVersion: LAN_CONTROL_STORE_VERSION,
      serverId,
      certificatePem: material.certificatePem,
      encryptedPrivateKey: this.protector.encrypt(material.privateKeyPem),
      clients: []
    }
  }

  private requireData(): LanControlStoreData {
    if (!this.data) throw new LanControlStoreError('LAN identity is not initialized.')
    return this.data
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation)
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

export function getTlsSpkiPin(certificatePem: string): {
  tlsSpkiSha256: string
  verificationCode: string
} {
  const certificate = new X509Certificate(certificatePem)
  const digest = createHash('sha256')
    .update(certificate.publicKey.export({ format: 'der', type: 'spki' }))
    .digest()
  const verificationCode = digest
    .subarray(0, 10)
    .toString('hex')
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join('-')
  if (!verificationCode) throw new LanControlStoreError('TLS verification code could not be built.')
  return {
    tlsSpkiSha256: `sha256/${digest.toString('base64')}`,
    verificationCode
  }
}

export function parseLanControlStore(value: unknown): LanControlStoreData {
  const record = readRecord(value, 'LAN control store')
  if (record.schemaVersion !== LAN_CONTROL_STORE_VERSION) {
    throw new TypeError('The LAN control store has an unsupported schema version.')
  }
  const clientsValue = readArray(record.clients, 'LAN clients')
  if (clientsValue.length > MAX_LAN_PAIRED_CLIENTS) {
    throw new RangeError(`No more than ${MAX_LAN_PAIRED_CLIENTS} LAN clients can be saved.`)
  }
  const ids = new Set<string>()
  const tokenHashes = new Set<string>()
  const clients = clientsValue.map((value) => {
    const client = readRecord(value, 'LAN client')
    const id = readUuid(client.id, 'LAN client ID')
    const tokenHash = readString(client.tokenHash, 'LAN client token hash', 43)
    if (!TOKEN_HASH_PATTERN.test(tokenHash)) {
      throw new TypeError('LAN client token hash is invalid.')
    }
    if (ids.has(id) || tokenHashes.has(tokenHash)) {
      throw new TypeError('LAN client identities and credentials must be unique.')
    }
    ids.add(id)
    tokenHashes.add(tokenHash)
    return {
      id,
      name: readNonEmptyString(client.name, 'LAN client name', 80),
      appVersion:
        client.appVersion === null
          ? null
          : readNonEmptyString(client.appVersion, 'LAN client version', 40),
      pairedAt: readTimestamp(client.pairedAt, 'LAN pairing time'),
      tokenHash
    }
  })

  return {
    schemaVersion: LAN_CONTROL_STORE_VERSION,
    serverId: readUuid(record.serverId, 'LAN server ID'),
    certificatePem: readPem(record.certificatePem, 'CERTIFICATE', 'LAN certificate'),
    encryptedPrivateKey: readNonEmptyString(
      record.encryptedPrivateKey,
      'Encrypted LAN private key',
      20_000
    ),
    clients
  }
}

async function generateLanCertificate(serverId: string): Promise<LanCertificateMaterial> {
  const notBeforeDate = new Date(Date.now() - 24 * 60 * 60 * 1_000)
  const notAfterDate = new Date(notBeforeDate)
  notAfterDate.setUTCFullYear(notAfterDate.getUTCFullYear() + 10)
  const generated = await generate([{ name: 'commonName', value: `Rockfall ${serverId}` }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyAgreement: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'rockfall.local' },
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' }
        ]
      }
    ]
  })
  return {
    certificatePem: generated.cert,
    privateKeyPem: generated.private
  }
}

function hydrateTlsIdentity(
  data: LanControlStoreData,
  protector: LanSecretProtector
): LanTlsIdentity {
  let privateKeyPem: string
  try {
    privateKeyPem = protector.decrypt(data.encryptedPrivateKey)
    const certificate = new X509Certificate(data.certificatePem)
    const privatePublicKey = createPublicKey(createPrivateKey(privateKeyPem)).export({
      format: 'der',
      type: 'spki'
    })
    const certificatePublicKey = certificate.publicKey.export({ format: 'der', type: 'spki' })
    if (
      privatePublicKey.byteLength !== certificatePublicKey.byteLength ||
      !timingSafeEqual(privatePublicKey, certificatePublicKey)
    ) {
      throw new Error('The saved LAN certificate does not match its private key.')
    }
  } catch (error) {
    throw new LanControlStoreError(
      'The saved LAN TLS identity could not be decrypted or verified.',
      {
        cause: error
      }
    )
  }

  return {
    serverId: data.serverId,
    certificatePem: data.certificatePem,
    privateKeyPem,
    ...getTlsSpkiPin(data.certificatePem)
  }
}

async function saveLanControlStore(path: string, data: LanControlStoreData): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await fs.rename(temporaryPath, path)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}

function hashToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function safeHashEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'ascii')
  const rightBytes = Buffer.from(right, 'ascii')
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
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
  const result = readString(value, label, maxLength).trim()
  if (!result) throw new TypeError(`${label} is required.`)
  return result
}

function readUuid(value: unknown, label: string): string {
  const result = readNonEmptyString(value, label, 36)
  if (!UUID_PATTERN.test(result)) throw new TypeError(`${label} must be a UUID.`)
  return result
}

function readTimestamp(value: unknown, label: string): string {
  const result = readNonEmptyString(value, label, 100)
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${label} is invalid.`)
  return result
}

function readPem(value: unknown, kind: string, label: string): string {
  const result = readNonEmptyString(value, label, 20_000)
  if (!result.startsWith(`-----BEGIN ${kind}-----`) || !result.includes(`-----END ${kind}-----`)) {
    throw new TypeError(`${label} is not valid PEM data.`)
  }
  return result
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
