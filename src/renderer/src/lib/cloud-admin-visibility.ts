import type { CloudSyncState } from '../../../shared/contracts'

export function canShowAdminCloudSettings(cloud: CloudSyncState): boolean {
  return cloud.user?.role === 'admin'
}
