import assert from 'node:assert/strict'
import test from 'node:test'

import type { CloudSyncState } from '../../../shared/contracts'
import { canShowAdminCloudSettings } from './cloud-admin-visibility'

test('shows admin cloud settings only to the exact server admin role', () => {
  assert.equal(canShowAdminCloudSettings(cloud(null)), false)
  assert.equal(canShowAdminCloudSettings(cloud('user')), false)
  assert.equal(canShowAdminCloudSettings(cloud('admin')), true)
})

function cloud(role: 'user' | 'admin' | null): CloudSyncState {
  return {
    status: role ? 'synced' : 'signed-out',
    user: role ? { id: 'user-id', displayName: 'Pilot', role } : null,
    message: '',
    lastSyncedAt: null,
    pendingOperationCount: 0,
    quarantinedOperationCount: 0,
    blockedProfileCount: 0,
    loginExpiresAt: null,
    refreshTokenPersistent: false
  }
}
