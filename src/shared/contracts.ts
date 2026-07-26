export const MAX_SELECTED_MATERIALS = 4
export const MIN_CLUSTER_SIZE = 1
export const MAX_CLUSTER_SIZE = 8
export const MIN_OVERLAY_FONT_SCALE = 0.8
export const MAX_OVERLAY_FONT_SCALE = 1.6
export const DEFAULT_OVERLAY_FONT_SCALE = 1
export const OVERLAY_FONT_SCALE_STEP = 0.05
export const HIGH_QUALITY_THRESHOLD = 500
export const MAX_RECOMMENDED_MINING_LOCATIONS = 5

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
  name: string
  displayName: string
  signature: number
  methods: MiningMethod[]
  sourceUrl: string
}

export interface MiningLocationRecommendation {
  id: string
  name: string
  area: string | null
  system: string
  type: string
  parentName: string | null
  highQualityProbability: number
  maxQuality: number
  maxComposition: number | null
  sourceUrl: string
}

export interface MiningLocationResult {
  materialId: string
  locations: MiningLocationRecommendation[]
  state: 'live' | 'cached'
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
      source: 'live' | 'cached'
      message: string
    }
  | {
      status: 'empty'
      location: null
      source: 'live' | 'cached'
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

export interface OverlaySettings {
  selectedMaterialIds: string[]
  signatureOverrides: SignatureOverrides
  clusterMax: number
  visible: boolean
  compact: boolean
  opacity: number
  fontScale: number
  placement: OverlayPlacement
  customPosition: OverlayPosition | null
  spotlightMaterialId: string | null
  shortcuts: Record<ShortcutId, string>
}

export type DataSourceState = 'loading' | 'live' | 'cached' | 'fallback'

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

export interface AppSnapshot {
  materials: MiningMaterial[]
  bestMiningLocations: Record<string, BestMiningLocationState>
  settings: OverlaySettings
  dataStatus: MiningDataStatus
  shortcuts: ShortcutStatus[]
  appUpdate: AppUpdateState
  warning: string | null
}

export type OverlaySettingsPatch = Partial<OverlaySettings>

export interface RockfallApi {
  getSnapshot: () => Promise<AppSnapshot>
  updateSettings: (patch: OverlaySettingsPatch) => Promise<AppSnapshot>
  reportOverlayMetrics: (metrics: OverlayContentMetrics) => Promise<void>
  refreshMaterials: () => Promise<AppSnapshot>
  getMiningLocations: (materialId: string) => Promise<MiningLocationResult>
  setShortcutCapture: (active: boolean) => Promise<AppSnapshot>
  checkForUpdates: () => Promise<AppSnapshot>
  restartToUpdate: () => Promise<void>
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => () => void
}

export const IPC_CHANNELS = {
  getSnapshot: 'rockfall:snapshot:get',
  updateSettings: 'rockfall:settings:update',
  reportOverlayMetrics: 'rockfall:overlay:metrics',
  refreshMaterials: 'rockfall:materials:refresh',
  getMiningLocations: 'rockfall:mining-locations:get',
  setShortcutCapture: 'rockfall:shortcuts:capture',
  checkForUpdates: 'rockfall:updates:check',
  restartToUpdate: 'rockfall:updates:restart',
  snapshotChanged: 'rockfall:snapshot:changed'
} as const
