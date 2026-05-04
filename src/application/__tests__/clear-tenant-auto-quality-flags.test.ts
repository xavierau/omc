import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/quality-auto-flags', () => ({
  clearAutoQualityFlags: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/infrastructure/supabase/audit-logger', () => ({
  logAdminAction: vi.fn(),
}))

import { clearTenantAutoQualityFlags } from '../clear-tenant-auto-quality-flags'
import { clearAutoQualityFlags } from '@/infrastructure/supabase/repositories/quality-auto-flags'
import { logAdminAction } from '@/infrastructure/supabase/audit-logger'

const mockClear = vi.mocked(clearAutoQualityFlags)
const mockAudit = vi.mocked(logAdminAction)

beforeEach(() => {
  mockClear.mockClear()
  mockAudit.mockClear()
})

describe('clearTenantAutoQualityFlags', () => {
  it('clears auto flags and writes an audit-log row', async () => {
    await clearTenantAutoQualityFlags({
      restaurantId: 'rest-1',
      actor: { userId: 'admin-1' },
    })

    expect(mockClear).toHaveBeenCalledWith('rest-1')
    expect(mockAudit).toHaveBeenCalledWith({
      userId: 'admin-1',
      action: 'tenant.clear_auto_quality_flags',
      resourceType: 'tenant_campaign_settings',
      resourceId: 'rest-1',
      details: expect.objectContaining({
        restaurantId: 'rest-1',
      }),
    })
  })

  it('rejects when restaurantId is empty', async () => {
    await expect(
      clearTenantAutoQualityFlags({
        restaurantId: '',
        actor: { userId: 'admin-1' },
      })
    ).rejects.toThrow(/restaurantId/)
  })

  it('rejects when actor.userId is empty', async () => {
    await expect(
      clearTenantAutoQualityFlags({
        restaurantId: 'rest-1',
        actor: { userId: '' },
      })
    ).rejects.toThrow(/actor/)
  })

  it('does not audit if the repo write fails', async () => {
    mockClear.mockRejectedValueOnce(new Error('db down'))
    await expect(
      clearTenantAutoQualityFlags({
        restaurantId: 'rest-1',
        actor: { userId: 'admin-1' },
      })
    ).rejects.toThrow(/db down/)
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
