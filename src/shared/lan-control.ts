import type { DataSourceState, MiningMethod } from './contracts'

export const LAN_PROTOCOL_VERSION = 1 as const
export const DEFAULT_LAN_CONTROL_PORT = 53_987
export const MIN_LAN_CONTROL_PORT = 1_024
export const MAX_LAN_CONTROL_PORT = 65_535
export const MAX_LAN_PAIRED_CLIENTS = 8
export const MAX_LAN_EVENT_STREAMS = 16

export interface LanControlConfig {
  enabled: boolean
  port: number
}

export type LanControlStatus =
  'disabled' | 'starting' | 'listening' | 'pairing' | 'degraded' | 'error'

export interface LanPairedClientSummary {
  id: string
  name: string
  appVersion: string | null
  pairedAt: string
}

export interface LanControlState {
  status: LanControlStatus
  enabled: boolean
  port: number
  endpoints: string[]
  serverId: string | null
  tlsSpkiSha256: string | null
  verificationCode: string | null
  pairingExpiresAt: string | null
  pairedClients: LanPairedClientSummary[]
  message: string
}

export interface LanPairingSession {
  code: string
  expiresAt: string
  endpoints: string[]
  serverId: string
  tlsSpkiSha256: string
  verificationCode: string
}

export interface LanServerIdentityV1 {
  id: string
  name: string
  appVersion: string
  tlsSpkiSha256: string
}

export interface LanCatalogItemV1 {
  id: string
  commodityId: string
  name: string
  displayName: string
  methods: MiningMethod[]
}

export interface LanOverlayStateV1 {
  protocolVersion: typeof LAN_PROTOCOL_VERSION
  server: Omit<LanServerIdentityV1, 'tlsSpkiSha256'> & {
    runId: string
  }
  revision: number
  catalog: {
    state: DataSourceState
    message: string
    updatedAt: string | null
    items: LanCatalogItemV1[]
  }
  overlay: {
    selectedItemIds: string[]
    maxSelectedItems: number
    compact: boolean
    spotlightItemId: string | null
  }
}

export type LanOverlayCommandV1 =
  | {
      operation: 'overlay.item.add'
      itemId: string
    }
  | {
      operation: 'overlay.item.remove'
      itemId: string
    }
  | {
      operation: 'overlay.compact.set'
      enabled: boolean
    }
  | {
      operation: 'overlay.target.cycle'
    }

export type LanCommandRequestV1 = LanOverlayCommandV1 & {
  requestId: string
  expected: {
    runId: string
    revision: number
  }
}

export interface LanPairingRequestV1 {
  code: string
  client: {
    name: string
    platform: 'android'
    appVersion: string | null
  }
}

export interface LanInfoResponseV1 {
  protocolVersion: typeof LAN_PROTOCOL_VERSION
  supportedProtocolVersions: [typeof LAN_PROTOCOL_VERSION]
  server: LanServerIdentityV1
  pairing: {
    required: true
    active: boolean
  }
  capabilities: LanOverlayCommandV1['operation'][]
}

export interface LanPairingResponseV1 {
  protocolVersion: typeof LAN_PROTOCOL_VERSION
  clientId: string
  accessToken: string
  server: LanServerIdentityV1
  state: LanOverlayStateV1
}

export interface LanCommandResponseV1 {
  protocolVersion: typeof LAN_PROTOCOL_VERSION
  requestId: string
  result: 'applied' | 'noop'
  state: LanOverlayStateV1
}

export type LanApiErrorCode =
  | 'invalid_json'
  | 'invalid_request'
  | 'unsupported_operation'
  | 'unsupported_version'
  | 'authentication_required'
  | 'invalid_token'
  | 'pairing_inactive'
  | 'pairing_rejected'
  | 'non_lan_peer'
  | 'route_not_found'
  | 'item_not_found'
  | 'revision_conflict'
  | 'selection_limit'
  | 'pairing_capacity_reached'
  | 'payload_too_large'
  | 'pairing_rate_limited'
  | 'catalog_unavailable'
  | 'service_stopping'
  | 'internal_error'

export interface LanErrorResponseV1 {
  protocolVersion: typeof LAN_PROTOCOL_VERSION
  requestId: string | null
  error: {
    code: LanApiErrorCode
    message: string
    retryable: boolean
    details: Record<string, unknown>
  }
  state?: LanOverlayStateV1
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseLanPairingRequest(value: unknown): LanPairingRequestV1 {
  const record = readRecord(value, 'Pairing request')
  const client = readRecord(record.client, 'Pairing client')
  const code = readString(record.code, 'Pairing code', 6)
  if (!/^[0-9]{6}$/.test(code)) {
    throw new TypeError('Pairing code must contain six digits.')
  }
  if (client.platform !== 'android') {
    throw new TypeError('Pairing client platform must be android.')
  }

  return {
    code,
    client: {
      name: readNonEmptyString(client.name, 'Pairing client name', 80),
      platform: 'android',
      appVersion:
        client.appVersion === undefined || client.appVersion === null
          ? null
          : readNonEmptyString(client.appVersion, 'Pairing client version', 40)
    }
  }
}

export function parseLanCommandRequest(value: unknown): LanCommandRequestV1 {
  const record = readRecord(value, 'LAN command')
  const expected = readRecord(record.expected, 'LAN command expectation')
  const command = parseLanOverlayCommand(record)
  const common = {
    requestId: readUuid(record.requestId, 'LAN command request ID'),
    expected: {
      runId: readUuid(expected.runId, 'LAN server run ID'),
      revision: readNonNegativeInteger(expected.revision, 'LAN state revision')
    }
  }

  return { ...common, ...command }
}

export function parseLanOverlayCommand(value: unknown): LanOverlayCommandV1 {
  const record = readRecord(value, 'Overlay command')
  switch (record.operation) {
    case 'overlay.item.add':
    case 'overlay.item.remove':
      return {
        operation: record.operation,
        itemId: readNonEmptyString(record.itemId, 'Overlay item ID', 200)
      }
    case 'overlay.compact.set':
      if (typeof record.enabled !== 'boolean') {
        throw new TypeError('Compact mode must be a boolean.')
      }
      return { operation: record.operation, enabled: record.enabled }
    case 'overlay.target.cycle':
      return { operation: record.operation }
    default:
      throw new RangeError('LAN command operation is not supported.')
  }
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
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

function readNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`)
  }
  return value
}
