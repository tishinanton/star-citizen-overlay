import type {
  LanControlConfig,
  LanControlState,
  LanOverlayCommandV1,
  LanPairingSession
} from './lan-control'

export const MAX_SELECTED_MATERIALS = 4
export const MIN_CLUSTER_SIZE = 1
export const MAX_CLUSTER_SIZE = 8
export const MIN_APP_FONT_SIZE = 14
export const MAX_APP_FONT_SIZE = 20
export const DEFAULT_APP_FONT_SIZE = 14
export const APP_FONT_SIZE_STEP = 1
export const MIN_OVERLAY_FONT_SCALE = 0.8
export const MAX_OVERLAY_FONT_SCALE = 1.6
export const DEFAULT_OVERLAY_FONT_SCALE = 1
export const OVERLAY_FONT_SCALE_STEP = 0.05
export const MIN_MINING_QUALITY_THRESHOLD = 0
export const MAX_MINING_QUALITY_THRESHOLD = 1_000
export const DEFAULT_MINING_QUALITY_THRESHOLD = 500
export const HIGH_QUALITY_THRESHOLD = DEFAULT_MINING_QUALITY_THRESHOLD

export type ShortcutId = 'toggle-overlay' | 'next-target' | 'show-all' | 'toggle-compact'

export const SHORTCUT_IDS: ShortcutId[] = [
  'toggle-overlay',
  'next-target',
  'show-all',
  'toggle-compact'
]

export const DEFAULT_SHORTCUTS: Record<ShortcutId, string> = {
  'toggle-overlay': 'CommandOrControl+Shift+M',
  'next-target': 'CommandOrControl+Shift+N',
  'show-all': 'CommandOrControl+Shift+A',
  'toggle-compact': 'CommandOrControl+Shift+C'
}

export type MiningMethod = 'Ship' | 'Ground Vehicle' | 'FPS' | 'Unclassified'

export interface MiningMaterial {
  id: string
  commodityId: string
  name: string
  displayName: string
  signature: number
  methods: MiningMethod[]
  sourceUrl: string
}

/**
 * Per-row identity provenance for a mining site recommendation. `'game'`
 * means both the identity (name/system/type) and the values (probability,
 * quality, composition) came from the installed local catalog. `'game-wiki'`
 * means the values are still authoritatively local, but the Wiki API
 * supplied the location's name/system/type because the local catalog could
 * not tie the provider to a single `StarMapObject`. `'wiki'` means both
 * identity and values came from the Star Citizen Wiki API (no usable local
 * catalog was available at all).
 */
export type MiningLocationIdentitySource = 'game' | 'game-wiki' | 'wiki'

export interface MiningQuantizationProbability {
  quality: number
  probability: number
}

export interface MiningRockCompositionPart {
  id: string
  materialId: string
  name: string
  isTarget: boolean
  minPercentage: number | null
  maxPercentage: number | null
  probability: number | null
  qualityScale: number | null
  curveExponent: number | null
  minQuality: number | null
  maxQuality: number | null
  meanQuality: number | null
  qualityStdDev: number | null
  quantizedValues: number[]
  quantizationProbabilities: MiningQuantizationProbability[]
}

export interface MiningRockCluster {
  key: string
  probability: number
  minSize: number | null
  maxSize: number | null
}

export interface MiningRockType {
  id: string
  key: string
  name: string
  signature: number | null
  groupName: string
  groupProbability: number | null
  relativeProbability: number | null
  minimumCompositionCount: number | null
  cluster: MiningRockCluster | null
  compositions: MiningRockCompositionPart[]
}

export interface MiningLocationRecommendation {
  id: string
  name: string
  area: string | null
  system: string
  type: string
  parentName: string | null
  rockSpawnProbability: number | null
  qualityThresholdProbability: number | null
  combinedProbability: number | null
  quantizationProbabilities: MiningQuantizationProbability[]
  minQuality: number | null
  maxQuality: number
  minComposition: number | null
  maxComposition: number | null
  rockTypes: MiningRockType[]
  identitySource: MiningLocationIdentitySource
  sourceUrl: string
}

/**
 * Coarse origin of a mining-location result's *values* (probability, quality,
 * composition). `'game'`/`'game-cached'` mean the installed local catalog was
 * used (freshly derived vs. served from the location cache); `'live'`/
 * `'cached'` mean the Star Citizen Wiki API was used end-to-end because no
 * usable local catalog was available. Independent of the per-row
 * `identitySource`, which can still mix in Wiki-sourced names on the game
 * path.
 */
export type MiningLocationSourceState = 'game' | 'game-cached' | 'live' | 'cached'

export interface MiningLocationResult {
  materialId: string
  qualityThreshold: number
  locations: MiningLocationRecommendation[]
  state: MiningLocationSourceState
  message: string
  updatedAt: string
}

export type LocalGameDataState = 'game' | 'cached'
export type BlueprintSourceState = LocalGameDataState
export type BlueprintIngredientKind = 'resource' | 'item' | 'unknown'

export interface BlueprintIngredient {
  name: string
  kind: BlueprintIngredientKind
  quantity: number | null
  quantityScu: number | null
  webUrl: string | null
}

export interface BlueprintSummary {
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
  ingredients: BlueprintIngredient[]
  gameVersion: string
  imageKey: string | null
  webUrl: string | null
}

export interface BlueprintRequirementIngredient extends BlueprintIngredient {
  minQuality: number | null
}

export interface BlueprintRequirementGroup {
  key: string
  name: string
  requiredCount: number
  ingredients: BlueprintRequirementIngredient[]
}

export interface BlueprintUnlockMission {
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

export interface BlueprintDetail extends BlueprintSummary {
  requirementGroups: BlueprintRequirementGroup[]
  unlockingMissions: BlueprintUnlockMission[]
}

export interface BlueprintCatalogResult {
  blueprints: BlueprintSummary[]
  icons: Record<string, string>
  state: BlueprintSourceState
  message: string
  updatedAt: string
}

export interface BlueprintDetailResult {
  blueprint: BlueprintDetail
  state: BlueprintSourceState
  message: string
  updatedAt: string
}

export type BlueprintOwnershipSource = 'default' | 'log' | 'manual'
export type BlueprintOwnershipStatus = 'scanning' | 'watching' | 'unavailable' | 'error'

export interface BlueprintOwnershipRecord {
  blueprintId: string
  source: BlueprintOwnershipSource
  acquiredAt: string | null
}

export interface BlueprintOwnershipSnapshot {
  records: Record<string, BlueprintOwnershipRecord>
  ownedCount: number
  defaultCount: number
  logCount: number
  manualCount: number
  status: BlueprintOwnershipStatus
  channel: string | null
  message: string
  warning: string | null
  filesScanned: number
  filesSkipped: number
  unassignedReceiptCount: number
  earliestLogAt: string | null
  lastScanAt: string | null
  unresolvedReceiptNames: string[]
}

export type FactionSourceState = LocalGameDataState
export type FactionAlignment = 'lawful' | 'unlawful' | 'unknown'

export interface FactionReputationStanding {
  id: string
  name: string
  minReputation: number
  driftReputation: number
  driftTimeHours: number
  gated: boolean
  perkDescription: string | null
}

export interface FactionReputationScope {
  id: string
  name: string
  description: string | null
  initialReputation: number
  reputationCeiling: number
  standings: FactionReputationStanding[]
}

export interface FactionReputation {
  id: string
  key: string
  name: string
  description: string | null
  alignment: FactionAlignment
  isNpc: boolean
  hidden: boolean
  headquarters: string | null
  focus: string | null
  scopeCount: number
  standingCount: number
  scopes: FactionReputationScope[]
}

export interface FactionCatalogResult {
  factions: FactionReputation[]
  gameVersion: string
  state: FactionSourceState
  message: string
  updatedAt: string
}

export type BestMiningLocationState =
  | {
      status: 'loading'
      location: null
      source: null
      message: string
    }
  | {
      status: 'ready'
      location: MiningLocationRecommendation
      qualityThreshold: number
      source: MiningLocationSourceState
      message: string
    }
  | {
      status: 'empty'
      location: null
      source: MiningLocationSourceState
      message: string
    }
  | {
      status: 'error'
      location: null
      source: null
      message: string
    }

export type OverlayPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface OverlayPosition {
  x: number
  y: number
}

export interface OverlayContentMetrics {
  layoutKey: string
  height: number
  headerHeight: number
}

export type SignatureOverrides = Record<string, number>
export type FavoriteMiningLocationIds = Record<string, string>

export interface OverlaySettings {
  selectedMaterialIds: string[]
  signatureOverrides: SignatureOverrides
  favoriteMiningLocationIds: FavoriteMiningLocationIds
  miningQualityThreshold: number
  clusterMax: number
  visible: boolean
  compact: boolean
  opacity: number
  appFontSize: number
  fontScale: number
  placement: OverlayPlacement
  customPosition: OverlayPosition | null
  spotlightMaterialId: string | null
  shortcuts: Record<ShortcutId, string>
  cloudApiUrl: string
  lanControl: LanControlConfig
}

export type DataSourceState = 'loading' | 'game' | 'live' | 'cached' | 'fallback'

export interface MiningDataStatus {
  state: DataSourceState
  message: string
  updatedAt: string | null
}

export interface ShortcutStatus {
  id: ShortcutId
  label: string
  accelerator: string
  registered: boolean
}

export type AppUpdateStatus =
  'unavailable' | 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  currentVersion: string
  availableVersion: string | null
  downloadProgress: number | null
  message: string
}

export type CloudSyncStatus =
  | 'signed-out'
  | 'connecting'
  | 'waiting-for-browser'
  | 'restoring'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'auth-expired'
  | 'error'

export interface CloudUserSummary {
  id: string
  displayName: string
  role: 'user' | 'admin'
}

export interface CloudSyncState {
  status: CloudSyncStatus
  user: CloudUserSummary | null
  message: string
  lastSyncedAt: string | null
  pendingOperationCount: number
  quarantinedOperationCount: number
  blockedProfileCount: number
  loginExpiresAt: string | null
  refreshTokenPersistent: boolean
}

export type StaticDataSyncStatus =
  | 'unavailable'
  | 'checking'
  | 'ready'
  | 'preparing'
  | 'confirming'
  | 'uploading'
  | 'validating'
  | 'published'
  | 'already-current'
  | 'error'

export interface StaticDataReleaseSummary {
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

export interface StaticDataPublicationResult extends StaticDataReleaseSummary {
  status: 'published' | 'alreadyPublished'
}

export interface StaticDataProgress {
  phase: string
  completed: number
  total: number
}

export interface StaticDataSyncState {
  status: StaticDataSyncStatus
  canPublish: boolean
  message: string
  progress: StaticDataProgress | null
  currentRelease: StaticDataReleaseSummary | null
}

export type StarStringsSyncStatus =
  | 'unavailable'
  | 'ready'
  | 'checking'
  | 'downloading'
  | 'installing'
  | 'current'
  | 'installed'
  | 'error'

export interface StarStringsReleaseSummary {
  version: string
  name: string
  publishedAt: string
}

export interface StarStringsInstallationSummary extends StarStringsReleaseSummary {
  installedAt: string
}

export interface StarStringsSyncState {
  status: StarStringsSyncStatus
  gamePath: string | null
  message: string
  progress: number | null
  installedRelease: StarStringsInstallationSummary | null
  availableRelease: StarStringsReleaseSummary | null
}

export interface AppSnapshot {
  materials: MiningMaterial[]
  bestMiningLocations: Record<string, BestMiningLocationState>
  settings: OverlaySettings
  dataStatus: MiningDataStatus
  gameDataPath: string | null
  shortcuts: ShortcutStatus[]
  appUpdate: AppUpdateState
  cloud: CloudSyncState
  staticData: StaticDataSyncState
  starStrings: StarStringsSyncState
  lanControl: LanControlState
  warning: string | null
}

export interface GameDataSelectionResult {
  snapshot: AppSnapshot
  changed: boolean
}

export type OverlaySettingsPatch = Partial<OverlaySettings>

export interface RockfallApi {
  getSnapshot: () => Promise<AppSnapshot>
  updateSettings: (patch: OverlaySettingsPatch) => Promise<AppSnapshot>
  executeOverlayCommand: (command: LanOverlayCommandV1) => Promise<AppSnapshot>
  reportOverlayMetrics: (metrics: OverlayContentMetrics) => Promise<void>
  refreshMaterials: () => Promise<AppSnapshot>
  chooseGameData: () => Promise<GameDataSelectionResult>
  getMiningLocations: (materialId: string) => Promise<MiningLocationResult>
  getBlueprintCatalog: (refresh?: boolean) => Promise<BlueprintCatalogResult>
  getBlueprintDetail: (blueprintId: string) => Promise<BlueprintDetailResult>
  getBlueprintOwnership: () => Promise<BlueprintOwnershipSnapshot>
  rescanBlueprintOwnership: () => Promise<BlueprintOwnershipSnapshot>
  setBlueprintOwned: (blueprintId: string, owned: boolean) => Promise<BlueprintOwnershipSnapshot>
  getFactionCatalog: (refresh?: boolean) => Promise<FactionCatalogResult>
  setShortcutCapture: (active: boolean) => Promise<AppSnapshot>
  beginCloudLogin: () => Promise<CloudSyncState>
  completeCloudLogin: (handoffCode: string) => Promise<CloudSyncState>
  cancelCloudLogin: () => Promise<CloudSyncState>
  syncCloud: () => Promise<CloudSyncState>
  confirmCloudProfileImport: () => Promise<CloudSyncState>
  logoutCloud: () => Promise<CloudSyncState>
  publishStaticData: () => Promise<StaticDataSyncState>
  syncStarStrings: () => Promise<StarStringsSyncState>
  checkForUpdates: () => Promise<AppSnapshot>
  restartToUpdate: () => Promise<void>
  configureLanControl: (config: LanControlConfig) => Promise<AppSnapshot>
  beginLanPairing: () => Promise<LanPairingSession>
  cancelLanPairing: () => Promise<AppSnapshot>
  revokeLanClient: (clientId: string) => Promise<AppSnapshot>
  resetLanIdentity: () => Promise<AppSnapshot>
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => () => void
  onBlueprintOwnership: (listener: (snapshot: BlueprintOwnershipSnapshot) => void) => () => void
}

export const IPC_CHANNELS = {
  getSnapshot: 'rockfall:snapshot:get',
  updateSettings: 'rockfall:settings:update',
  executeOverlayCommand: 'rockfall:overlay:command',
  reportOverlayMetrics: 'rockfall:overlay:metrics',
  refreshMaterials: 'rockfall:materials:refresh',
  chooseGameData: 'rockfall:game-data:choose',
  getMiningLocations: 'rockfall:mining-locations:get',
  getBlueprintCatalog: 'rockfall:blueprints:get',
  getBlueprintDetail: 'rockfall:blueprints:detail',
  getBlueprintOwnership: 'rockfall:blueprints:ownership:get',
  rescanBlueprintOwnership: 'rockfall:blueprints:ownership:rescan',
  setBlueprintOwned: 'rockfall:blueprints:ownership:set',
  blueprintOwnershipChanged: 'rockfall:blueprints:ownership:changed',
  getFactionCatalog: 'rockfall:factions:get',
  setShortcutCapture: 'rockfall:shortcuts:capture',
  beginCloudLogin: 'rockfall:cloud:login',
  completeCloudLogin: 'rockfall:cloud:login:complete',
  cancelCloudLogin: 'rockfall:cloud:login:cancel',
  syncCloud: 'rockfall:cloud:sync',
  confirmCloudProfileImport: 'rockfall:cloud:import:confirm',
  logoutCloud: 'rockfall:cloud:logout',
  publishStaticData: 'rockfall:static-data:publish',
  syncStarStrings: 'rockfall:starstrings:sync',
  checkForUpdates: 'rockfall:updates:check',
  restartToUpdate: 'rockfall:updates:restart',
  configureLanControl: 'rockfall:lan:configure',
  beginLanPairing: 'rockfall:lan:pairing:begin',
  cancelLanPairing: 'rockfall:lan:pairing:cancel',
  revokeLanClient: 'rockfall:lan:client:revoke',
  resetLanIdentity: 'rockfall:lan:identity:reset',
  snapshotChanged: 'rockfall:snapshot:changed'
} as const
