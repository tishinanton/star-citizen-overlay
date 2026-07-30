import type { CloudSyncState } from '../../../shared/contracts'

export function canShowStaticDataSync(cloud: CloudSyncState): boolean {
  return cloud.user?.role === 'admin'
}
