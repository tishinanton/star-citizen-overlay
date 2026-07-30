import { createHash } from 'node:crypto'
import { gzipSync, inflateSync } from 'node:zlib'

import type {
  BlueprintDetail,
  BlueprintIngredient,
  BlueprintRequirementGroup,
  BlueprintRequirementIngredient,
  BlueprintUnlockMission,
  FactionReputation,
  FactionReputationScope,
  FactionReputationStanding,
  MiningMaterial,
  MiningMethod
} from '../shared/contracts'

const PUBLICATION_SCHEMA_VERSION = 1
const DATASET_COMPRESSION_LEVEL = 9
const MAX_PUBLICATION_BYTES = 128 * 1024 * 1024
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_ARCHIVE_ENTRIES = 204
const MAX_ASSET_COUNT = 200
const MAX_ASSET_BYTES = 128 * 1024
const MAX_ASSET_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 2_048
const MAX_IMAGE_PIXELS = 4_194_304
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ZIP_VERSION = 20
const ZIP_UTF8_FLAG = 0x0800
const ZIP_STORE_METHOD = 0
const ZIP_DOS_TIME = 0
const ZIP_DOS_DATE = 33
export const STATIC_DATA_RESOURCE_RECORD_LIMITS = {
  signatures: 128,
  blueprints: 2_500,
  'faction-reputation': 100
} as const
export const STATIC_DATA_RESOURCE_BYTE_LIMITS = {
  signatures: {
    compressedBytes: 2 * 1024 * 1024,
    uncompressedBytes: 4 * 1024 * 1024
  },
  blueprints: {
    compressedBytes: 32 * 1024 * 1024,
    uncompressedBytes: 64 * 1024 * 1024
  },
  'faction-reputation': {
    compressedBytes: 16 * 1024 * 1024,
    uncompressedBytes: 32 * 1024 * 1024
  }
} as const
export const STATIC_DATA_AGGREGATE_RESOURCE_BYTE_LIMITS = {
  compressedBytes: 48 * 1024 * 1024,
  uncompressedBytes: 128 * 1024 * 1024
} as const
const METHOD_ORDER: Record<MiningMethod, number> = {
  Ship: 0,
  'Ground Vehicle': 1,
  FPS: 2,
  Unclassified: 3
}
const RESOURCE_LIMITS: Record<
  StaticDataResourceName,
  { records: number; compressedBytes: number; uncompressedBytes: number }
> = {
  signatures: {
    records: STATIC_DATA_RESOURCE_RECORD_LIMITS.signatures,
    ...STATIC_DATA_RESOURCE_BYTE_LIMITS.signatures
  },
  blueprints: {
    records: STATIC_DATA_RESOURCE_RECORD_LIMITS.blueprints,
    ...STATIC_DATA_RESOURCE_BYTE_LIMITS.blueprints
  },
  'faction-reputation': {
    records: STATIC_DATA_RESOURCE_RECORD_LIMITS['faction-reputation'],
    ...STATIC_DATA_RESOURCE_BYTE_LIMITS['faction-reputation']
  }
}

export const STATIC_DATA_PATHS = {
  manifest: 'manifest.json',
  signatures: 'datasets/signatures.json.gz',
  blueprints: 'datasets/blueprints.json.gz',
  factionReputation: 'datasets/faction-reputation.json.gz'
} as const

export interface StaticDataPublicationSource {
  gameBuild: string
  gameVersion: string
  channel: string
  archiveBytes: number
  archiveModifiedAt: string
  desktopVersion: string
}

export interface StaticDataPublicationInput {
  releaseId: string
  generatedAt: string
  source: StaticDataPublicationSource
  materials: readonly MiningMaterial[]
  blueprints: readonly BlueprintDetail[]
  icons: Readonly<Record<string, string>>
  factions: readonly FactionReputation[]
}

export interface PublicationSignatureV1 {
  id: string
  commodityId: string
  name: string
  displayName: string
  signature: number
  methods: MiningMethod[]
  sourceUrl: string
}

export interface PublicationIngredientV1 {
  name: string
  kind: BlueprintIngredient['kind']
  quantity: number | null
  quantityScu: number | null
  webUrl: string | null
}

export interface PublicationRequirementIngredientV1 extends PublicationIngredientV1 {
  minQuality: number | null
}

export interface PublicationRequirementGroupV1 {
  key: string
  name: string
  requiredCount: number
  ingredients: PublicationRequirementIngredientV1[]
}

export interface PublicationMissionV1 {
  id: string
  title: string
  missionType: string | null
  contractType: string | null
  provider: string | null
  minimumReputation: string | null
  reputationVaries: boolean
  starSystems: string[]
  chance: number | null
  webUrl: string | null
}

export interface PublicationBlueprintV1 {
  id: string
  key: string
  outputName: string
  outputClass: string
  outputType: string
  outputTypeLabel: string
  outputGrade: string | null
  craftTimeSeconds: number
  craftTimeLabel: string
  availableByDefault: boolean
  ingredientCount: number
  unlockingMissionCount: number
  ingredients: PublicationIngredientV1[]
  gameVersion: string
  assetKey: string | null
  webUrl: string | null
  requirementGroups: PublicationRequirementGroupV1[]
  unlockingMissions: PublicationMissionV1[]
}

export interface PublicationStandingV1 {
  id: string
  name: string
  minReputation: number
  driftReputation: number
  driftTimeHours: number
  gated: boolean
  perkDescription: string | null
}

export interface PublicationScopeV1 {
  id: string
  name: string
  description: string | null
  initialReputation: number
  reputationCeiling: number
  standings: PublicationStandingV1[]
}

export interface PublicationFactionV1 {
  id: string
  key: string
  name: string
  description: string | null
  alignment: FactionReputation['alignment']
  isNpc: boolean
  hidden: boolean
  headquarters: string | null
  focus: string | null
  scopeCount: number
  standingCount: number
  scopes: PublicationScopeV1[]
}

export type StaticDataResourceName = 'signatures' | 'blueprints' | 'faction-reputation'

export interface StaticDataResourceManifestV1 {
  name: StaticDataResourceName
  schemaVersion: 1
  file: string
  mediaType: 'application/json'
  contentEncoding: 'gzip'
  recordCount: number
  uncompressedBytes: number
  compressedBytes: number
  sha256: string
}

export interface StaticDataAssetManifestV1 {
  key: string
  file: string
  mediaType: 'image/png'
  byteLength: number
  sha256: string
  width: number
  height: number
}

export interface StaticDataManifestV1 {
  contractVersion: 1
  releaseId: string
  channel: string
  gameBuild: string
  gameVersion: string
  generatedAt: string
  sourceAppVersion: string
  source: {
    dataP4kBytes: number
    dataP4kLastWriteAt: string
  }
  resources: StaticDataResourceManifestV1[]
  assets: StaticDataAssetManifestV1[]
}

export interface StaticDataPublication {
  archive: Buffer
  archiveSha256: string
  manifest: StaticDataManifestV1
  manifestBytes: number
}

interface PublicationAsset {
  manifest: StaticDataAssetManifestV1
  bytes: Buffer
}

interface PublicationResource {
  manifest: StaticDataResourceManifestV1
  bytes: Buffer
}

interface ZipEntry {
  path: string
  bytes: Buffer
}

export function createStaticDataPublication(
  input: StaticDataPublicationInput
): StaticDataPublication {
  validateReleaseMetadata(input)
  const { blueprints, assets } = adaptBlueprints(input.blueprints, input.icons)
  const signatures = createResource(
    'signatures',
    STATIC_DATA_PATHS.signatures,
    input.materials.length,
    {
      schemaVersion: PUBLICATION_SCHEMA_VERSION,
      materials: input.materials
        .map(toPublicationSignature)
        .sort((left, right) => left.id.localeCompare(right.id))
    }
  )
  const blueprintResource = createResource(
    'blueprints',
    STATIC_DATA_PATHS.blueprints,
    blueprints.length,
    {
      schemaVersion: PUBLICATION_SCHEMA_VERSION,
      gameVersion: input.source.gameBuild,
      blueprints
    }
  )
  const factionReputation = createResource(
    'faction-reputation',
    STATIC_DATA_PATHS.factionReputation,
    input.factions.length,
    {
      schemaVersion: PUBLICATION_SCHEMA_VERSION,
      gameVersion: input.source.gameBuild,
      factions: input.factions
        .map(toPublicationFaction)
        .sort((left, right) => left.id.localeCompare(right.id))
    }
  )
  const resources = [blueprintResource, factionReputation, signatures]
  const aggregateCompressedBytes = resources.reduce(
    (total, resource) => total + resource.manifest.compressedBytes,
    0
  )
  const aggregateUncompressedBytes = resources.reduce(
    (total, resource) => total + resource.manifest.uncompressedBytes,
    0
  )
  if (
    aggregateCompressedBytes > STATIC_DATA_AGGREGATE_RESOURCE_BYTE_LIMITS.compressedBytes ||
    aggregateUncompressedBytes > STATIC_DATA_AGGREGATE_RESOURCE_BYTE_LIMITS.uncompressedBytes
  ) {
    throw new RangeError('The static-data resources exceed the aggregate API size limits.')
  }
  if (assets.length > MAX_ASSET_COUNT) {
    throw new RangeError(`The API accepts at most ${MAX_ASSET_COUNT} static-data assets.`)
  }
  const aggregateAssetBytes = assets.reduce((total, asset) => total + asset.bytes.byteLength, 0)
  if (aggregateAssetBytes > MAX_ASSET_TOTAL_BYTES) {
    throw new RangeError('The static-data assets exceed the aggregate API size limit.')
  }

  const manifest: StaticDataManifestV1 = {
    contractVersion: PUBLICATION_SCHEMA_VERSION,
    releaseId: input.releaseId,
    channel: input.source.channel,
    gameBuild: input.source.gameBuild,
    gameVersion: input.source.gameVersion,
    generatedAt: input.generatedAt,
    sourceAppVersion: input.source.desktopVersion,
    source: {
      dataP4kBytes: input.source.archiveBytes,
      dataP4kLastWriteAt: input.source.archiveModifiedAt
    },
    resources: resources.map((resource) => resource.manifest),
    assets: assets.map((asset) => asset.manifest)
  }
  const manifestJson = serializeCanonicalJson(manifest)
  if (manifestJson.byteLength > MAX_MANIFEST_BYTES) {
    throw new RangeError('The static-data manifest exceeds the API size limit.')
  }
  const entries: ZipEntry[] = [
    { path: STATIC_DATA_PATHS.manifest, bytes: manifestJson },
    { path: signatures.manifest.file, bytes: signatures.bytes },
    { path: blueprintResource.manifest.file, bytes: blueprintResource.bytes },
    { path: factionReputation.manifest.file, bytes: factionReputation.bytes },
    ...assets.map((asset) => ({ path: asset.manifest.file, bytes: asset.bytes }))
  ].sort((left, right) => left.path.localeCompare(right.path))
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new RangeError(`The API accepts at most ${MAX_ARCHIVE_ENTRIES} archive entries.`)
  }
  const archive = createDeterministicZip(entries)
  if (archive.byteLength > MAX_PUBLICATION_BYTES) {
    throw new RangeError(
      `The static-data publication is ${archive.byteLength} bytes; the API accepts at most ${MAX_PUBLICATION_BYTES} bytes.`
    )
  }
  return {
    archive,
    archiveSha256: sha256(archive),
    manifest,
    manifestBytes: manifestJson.byteLength
  }
}

export function serializeCanonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
}

export function createDeterministicGzip(value: Buffer): Buffer {
  const compressed = gzipSync(value, { level: DATASET_COMPRESSION_LEVEL })
  compressed.fill(0, 4, 8)
  compressed[9] = 255
  return compressed
}

export function createDeterministicZip(entries: readonly ZipEntry[]): Buffer {
  const sorted = [...entries].sort((left, right) => left.path.localeCompare(right.path))
  const paths = new Set<string>()
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of sorted) {
    assertSafeArchivePath(entry.path)
    if (paths.has(entry.path)) throw new Error(`Duplicate ZIP entry: ${entry.path}`)
    paths.add(entry.path)
    const name = Buffer.from(entry.path, 'utf8')
    const checksum = crc32(entry.bytes)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(ZIP_VERSION, 4)
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6)
    localHeader.writeUInt16LE(ZIP_STORE_METHOD, 8)
    localHeader.writeUInt16LE(ZIP_DOS_TIME, 10)
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(entry.bytes.byteLength, 18)
    localHeader.writeUInt32LE(entry.bytes.byteLength, 22)
    localHeader.writeUInt16LE(name.byteLength, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, name, entry.bytes)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(ZIP_VERSION, 4)
    centralHeader.writeUInt16LE(ZIP_VERSION, 6)
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8)
    centralHeader.writeUInt16LE(ZIP_STORE_METHOD, 10)
    centralHeader.writeUInt16LE(ZIP_DOS_TIME, 12)
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(entry.bytes.byteLength, 20)
    centralHeader.writeUInt32LE(entry.bytes.byteLength, 24)
    centralHeader.writeUInt16LE(name.byteLength, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)
    offset += localHeader.byteLength + name.byteLength + entry.bytes.byteLength
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(sorted.length, 8)
  end.writeUInt16LE(sorted.length, 10)
  end.writeUInt32LE(centralDirectory.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDirectory, end])
}

function validateReleaseMetadata(input: StaticDataPublicationInput): void {
  if (!isUuid(input.releaseId)) throw new TypeError('Static-data release ID must be a UUID.')
  assertTimestamp(input.generatedAt, 'Static-data generation time')
  assertNonEmpty(input.source.gameBuild, 'Game build')
  assertNonEmpty(input.source.gameVersion, 'Game version')
  assertNonEmpty(input.source.channel, 'Game channel')
  assertNonEmpty(input.source.desktopVersion, 'Desktop version')
  if (!Number.isSafeInteger(input.source.archiveBytes) || input.source.archiveBytes <= 0) {
    throw new TypeError('Game archive byte length must be a positive safe integer.')
  }
  assertTimestamp(input.source.archiveModifiedAt, 'Game archive modification time')
  if (
    input.materials.length === 0 ||
    input.blueprints.length === 0 ||
    input.factions.length === 0
  ) {
    throw new Error('Every static-data dataset must contain records.')
  }
  const mismatchedBlueprint = input.blueprints.find(
    (blueprint) => blueprint.gameVersion !== input.source.gameBuild
  )
  if (mismatchedBlueprint) {
    throw new Error(
      `Blueprint ${mismatchedBlueprint.id} targets ${mismatchedBlueprint.gameVersion}; expected build ${input.source.gameBuild}.`
    )
  }
}

function createResource(
  name: StaticDataResourceName,
  file: string,
  recordCount: number,
  value: unknown
): PublicationResource {
  const json = serializeCanonicalJson(value)
  const compressed = createDeterministicGzip(json)
  const limits = RESOURCE_LIMITS[name]
  if (
    recordCount > limits.records ||
    json.byteLength > limits.uncompressedBytes ||
    compressed.byteLength > limits.compressedBytes
  ) {
    throw new RangeError(`The ${name} resource exceeds the API publication limits.`)
  }
  return {
    bytes: compressed,
    manifest: {
      name,
      schemaVersion: PUBLICATION_SCHEMA_VERSION,
      file,
      mediaType: 'application/json',
      contentEncoding: 'gzip',
      recordCount,
      uncompressedBytes: json.byteLength,
      compressedBytes: compressed.byteLength,
      sha256: sha256(json)
    }
  }
}

function toPublicationSignature(material: MiningMaterial): PublicationSignatureV1 {
  return {
    id: material.id,
    commodityId: material.commodityId,
    name: material.name,
    displayName: material.displayName,
    signature: material.signature,
    methods: [...material.methods].sort((left, right) => METHOD_ORDER[left] - METHOD_ORDER[right]),
    sourceUrl: material.sourceUrl
  }
}

function adaptBlueprints(
  blueprints: readonly BlueprintDetail[],
  icons: Readonly<Record<string, string>>
): { blueprints: PublicationBlueprintV1[]; assets: PublicationAsset[] } {
  const referencedImageKeys = new Set(
    blueprints
      .map((blueprint) => blueprint.imageKey)
      .filter((imageKey): imageKey is string => imageKey !== null)
  )
  const suppliedImageKeys = new Set(Object.keys(icons))
  assertEqualSets(referencedImageKeys, suppliedImageKeys, 'blueprint image keys')

  const keyByImage = new Map<string, string>()
  const assetsByKey = new Map<string, PublicationAsset>()
  for (const imageKey of [...referencedImageKeys].sort()) {
    const bytes = decodePngDataUrl(icons[imageKey], imageKey)
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      throw new RangeError(`Blueprint icon ${imageKey} exceeds the API size limit.`)
    }
    const digest = sha256(bytes)
    const key = `blueprint-icons/${digest}.png`
    const file = `assets/${key}`
    keyByImage.set(imageKey, key)
    if (!assetsByKey.has(key)) {
      const dimensions = readPngDimensions(bytes, imageKey)
      assetsByKey.set(key, {
        bytes,
        manifest: {
          key,
          file,
          mediaType: 'image/png',
          byteLength: bytes.byteLength,
          sha256: digest,
          width: dimensions.width,
          height: dimensions.height
        }
      })
    }
  }

  const publicationBlueprints = blueprints
    .map((blueprint) => toPublicationBlueprint(blueprint, keyByImage))
    .sort((left, right) => left.id.localeCompare(right.id))
  const referencedAssetKeys = new Set(
    publicationBlueprints
      .map((blueprint) => blueprint.assetKey)
      .filter((assetKey): assetKey is string => assetKey !== null)
  )
  assertEqualSets(referencedAssetKeys, new Set(assetsByKey.keys()), 'blueprint asset keys')
  return {
    blueprints: publicationBlueprints,
    assets: [...assetsByKey.values()].sort((left, right) =>
      left.manifest.key.localeCompare(right.manifest.key)
    )
  }
}

function toPublicationBlueprint(
  blueprint: BlueprintDetail,
  keyByImage: ReadonlyMap<string, string>
): PublicationBlueprintV1 {
  const assetKey = blueprint.imageKey === null ? null : keyByImage.get(blueprint.imageKey)
  if (blueprint.imageKey !== null && !assetKey) {
    throw new Error(`Blueprint ${blueprint.id} references an undeclared icon.`)
  }
  return {
    id: blueprint.id,
    key: blueprint.key,
    outputName: blueprint.outputName,
    outputClass: blueprint.outputClass,
    outputType: blueprint.outputType,
    outputTypeLabel: blueprint.outputTypeLabel,
    outputGrade: blueprint.outputGrade,
    craftTimeSeconds: blueprint.craftTimeSeconds,
    craftTimeLabel: blueprint.craftTimeLabel,
    availableByDefault: blueprint.availableByDefault,
    ingredientCount: blueprint.ingredientCount,
    unlockingMissionCount: blueprint.unlockingMissionCount,
    ingredients: blueprint.ingredients.map(toPublicationIngredient),
    gameVersion: blueprint.gameVersion,
    assetKey: assetKey ?? null,
    webUrl: blueprint.webUrl,
    requirementGroups: blueprint.requirementGroups
      .map(toPublicationRequirementGroup)
      .sort((left, right) => left.key.localeCompare(right.key)),
    unlockingMissions: blueprint.unlockingMissions
      .map(toPublicationMission)
      .sort((left, right) => left.id.localeCompare(right.id))
  }
}

function toPublicationIngredient(ingredient: BlueprintIngredient): PublicationIngredientV1 {
  return {
    name: ingredient.name,
    kind: ingredient.kind,
    quantity: ingredient.quantity,
    quantityScu: ingredient.quantityScu,
    webUrl: ingredient.webUrl
  }
}

function toPublicationRequirementIngredient(
  ingredient: BlueprintRequirementIngredient
): PublicationRequirementIngredientV1 {
  return {
    ...toPublicationIngredient(ingredient),
    minQuality: ingredient.minQuality
  }
}

function toPublicationRequirementGroup(
  group: BlueprintRequirementGroup
): PublicationRequirementGroupV1 {
  return {
    key: group.key,
    name: group.name,
    requiredCount: group.requiredCount,
    ingredients: group.ingredients.map(toPublicationRequirementIngredient)
  }
}

function toPublicationMission(mission: BlueprintUnlockMission): PublicationMissionV1 {
  return {
    id: mission.id,
    title: mission.title,
    missionType: mission.missionType,
    contractType: mission.contractType,
    provider: mission.provider,
    minimumReputation: mission.minimumReputation,
    reputationVaries: mission.reputationVaries,
    starSystems: [...mission.starSystems].sort(),
    chance: mission.chance,
    webUrl: mission.webUrl
  }
}

function toPublicationFaction(faction: FactionReputation): PublicationFactionV1 {
  return {
    id: faction.id,
    key: faction.key,
    name: faction.name,
    description: faction.description,
    alignment: faction.alignment,
    isNpc: faction.isNpc,
    hidden: faction.hidden,
    headquarters: faction.headquarters,
    focus: faction.focus,
    scopeCount: faction.scopeCount,
    standingCount: faction.standingCount,
    scopes: faction.scopes
      .map(toPublicationScope)
      .sort((left, right) => left.id.localeCompare(right.id))
  }
}

function toPublicationScope(scope: FactionReputationScope): PublicationScopeV1 {
  return {
    id: scope.id,
    name: scope.name,
    description: scope.description,
    initialReputation: scope.initialReputation,
    reputationCeiling: scope.reputationCeiling,
    standings: scope.standings
      .map(toPublicationStanding)
      .sort((left, right) => left.id.localeCompare(right.id))
  }
}

function toPublicationStanding(standing: FactionReputationStanding): PublicationStandingV1 {
  return {
    id: standing.id,
    name: standing.name,
    minReputation: standing.minReputation,
    driftReputation: standing.driftReputation,
    driftTimeHours: standing.driftTimeHours,
    gated: standing.gated,
    perkDescription: standing.perkDescription
  }
}

function decodePngDataUrl(value: string | undefined, imageKey: string): Buffer {
  const prefix = 'data:image/png;base64,'
  if (!value?.startsWith(prefix)) throw new TypeError(`Blueprint icon ${imageKey} is not PNG data.`)
  const encoded = value.slice(prefix.length)
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new TypeError(`Blueprint icon ${imageKey} has invalid base64 data.`)
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.subarray(0, PNG_SIGNATURE.length).compare(PNG_SIGNATURE) !== 0) {
    throw new TypeError(`Blueprint icon ${imageKey} has an invalid PNG signature.`)
  }
  return bytes
}

function readPngDimensions(bytes: Buffer, imageKey: string): { width: number; height: number } {
  if (
    bytes.byteLength < 33 ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new TypeError(`Blueprint icon ${imageKey} has an invalid PNG header.`)
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const bitDepth = bytes[24]
  const colorType = bytes[25]
  const bitsPerPixel = readPngBitsPerPixel(bitDepth, colorType)
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new TypeError(`Blueprint icon ${imageKey} has invalid dimensions.`)
  }
  if (bitsPerPixel === null || bytes[26] !== 0 || bytes[27] !== 0) {
    throw new TypeError(`Blueprint icon ${imageKey} has an unsupported PNG format.`)
  }
  if (bytes[28] !== 0) {
    throw new TypeError(`Blueprint icon ${imageKey} uses unsupported PNG interlacing.`)
  }
  let offset = 8
  let chunkIndex = 0
  let foundEnd = false
  let foundImageData = false
  let imageDataEnded = false
  const imageDataChunks: Buffer[] = []
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) {
      throw new TypeError(`Blueprint icon ${imageKey} has an invalid PNG chunk.`)
    }
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.byteLength) {
      throw new TypeError(`Blueprint icon ${imageKey} has an invalid PNG chunk length.`)
    }
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const expectedChecksum = bytes.readUInt32BE(offset + 8 + length)
    const actualChecksum = crc32(bytes.subarray(offset + 4, offset + 8 + length))
    if (actualChecksum !== expectedChecksum) {
      throw new TypeError(`Blueprint icon ${imageKey} has an invalid ${type} chunk CRC.`)
    }
    if (chunkIndex === 0 && (type !== 'IHDR' || length !== 13)) {
      throw new TypeError(`Blueprint icon ${imageKey} has an invalid first PNG chunk.`)
    }
    if (type === 'acTL') {
      throw new TypeError(`Blueprint icon ${imageKey} uses unsupported PNG animation.`)
    }
    if (type === 'IDAT') {
      if (imageDataEnded) {
        throw new TypeError(`Blueprint icon ${imageKey} has invalid PNG image data ordering.`)
      }
      foundImageData = true
      imageDataChunks.push(bytes.subarray(offset + 8, offset + 8 + length))
    } else if (foundImageData && type !== 'IEND') {
      imageDataEnded = true
    }
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.byteLength) {
        throw new TypeError(`Blueprint icon ${imageKey} has an invalid PNG ending.`)
      }
      foundEnd = true
      break
    }
    offset = end
    chunkIndex += 1
  }
  if (!foundEnd) throw new TypeError(`Blueprint icon ${imageKey} has no terminal PNG ending.`)
  if (!foundImageData) throw new TypeError(`Blueprint icon ${imageKey} has no PNG image data.`)
  validatePngImageData(
    Buffer.concat(imageDataChunks),
    width,
    height,
    bitsPerPixel,
    imageKey
  )
  return { width, height }
}

function readPngBitsPerPixel(bitDepth: number, colorType: number): number | null {
  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4
  const allowedDepths =
    colorType === 0
      ? [1, 2, 4, 8, 16]
      : colorType === 2 || colorType === 4 || colorType === 6
        ? [8, 16]
        : colorType === 3
          ? [1, 2, 4, 8]
          : []
  return allowedDepths.includes(bitDepth) ? channels * bitDepth : null
}

function validatePngImageData(
  compressed: Buffer,
  width: number,
  height: number,
  bitsPerPixel: number,
  imageKey: string
): void {
  const scanlineBytes = Math.ceil((width * bitsPerPixel) / 8)
  const expectedBytes = (scanlineBytes + 1) * height
  let decoded: Buffer
  let consumedBytes: number
  try {
    const result: unknown = inflateSync(compressed, { info: true, maxOutputLength: expectedBytes })
    if (!isInflateInfoResult(result)) {
      throw new TypeError('The PNG inflater did not return stream consumption metadata.')
    }
    decoded = result.buffer
    consumedBytes = result.engine.bytesWritten
  } catch (error: unknown) {
    throw new TypeError(`Blueprint icon ${imageKey} has invalid PNG image data.`, {
      cause: error
    })
  }
  if (consumedBytes !== compressed.byteLength || decoded.byteLength !== expectedBytes) {
    throw new TypeError(`Blueprint icon ${imageKey} has invalid PNG image data.`)
  }
  for (let row = 0; row < height; row += 1) {
    if (decoded[row * (scanlineBytes + 1)] > 4) {
      throw new TypeError(`Blueprint icon ${imageKey} has an invalid PNG scanline filter.`)
    }
  }

  function isInflateInfoResult(
    value: unknown
  ): value is { buffer: Buffer; engine: { bytesWritten: number } } {
    if (typeof value !== 'object' || value === null || !('buffer' in value) || !('engine' in value)) {
      return false
    }
    const engine = value.engine
    return (
      Buffer.isBuffer(value.buffer) &&
      typeof engine === 'object' &&
      engine !== null &&
      'bytesWritten' in engine &&
      typeof engine.bytesWritten === 'number'
    )
  }
}

function assertEqualSets(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
  label: string
): void {
  const missing = [...left].filter((value) => !right.has(value))
  const extra = [...right].filter((value) => !left.has(value))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Static-data ${label} do not match (missing: ${missing.join(', ') || 'none'}; extra: ${
        extra.join(', ') || 'none'
      }).`
    )
  }
}

function assertSafeArchivePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > 180 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path
      .split('/')
      .some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    !/^[a-z0-9][a-z0-9._/-]*$/.test(path)
  ) {
    throw new TypeError(`Unsafe static-data archive path: ${path}`)
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${label} must be a timestamp.`)
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new TypeError(`${label} cannot be empty.`)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
