import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/quality-auto-flags', () => ({
  clearAutoQualityFlags: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/infrastructure/supabase/audit-logger', () => ({
  logAdminAction: vi.fn(),
}))

import { clearTenantAutoQualityFlags } from '../clear-tenant-auto-quality-flags'
import { ForbiddenError } from '../forbidden-error'
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
      actor: { userId: 'admin-1', role: 'platform_admin' },
    })

    expect(mockClear).toHaveBeenCalledWith('rest-1')
    expect(mockAudit).toHaveBeenCalledWith({
      userId: 'admin-1',
      action: 'tenant.clear_auto_quality_flags',
      resourceType: 'tenant_campaign_settings',
      resourceId: 'rest-1',
      details: expect.objectContaining({
        restaurantId: 'rest-1',
        actorRole: 'platform_admin',
      }),
    })
  })

  it('rejects when restaurantId is empty', async () => {
    await expect(
      clearTenantAutoQualityFlags({
        restaurantId: '',
        actor: { userId: 'admin-1', role: 'platform_admin' },
      })
    ).rejects.toThrow(/restaurantId/)
  })

  it('rejects when actor.userId is empty', async () => {
    await expect(
      clearTenantAutoQualityFlags({
        restaurantId: 'rest-1',
        actor: { userId: '', role: 'platform_admin' },
      })
    ).rejects.toThrow(/actor/)
  })

  it('rejects non-platform-admin actor with ForbiddenError', async () => {
    await expect(
      clearTenantAutoQualityFlags({
        restaurantId: 'rest-1',
        actor: { userId: 'user-1', role: 'tenant_user' },
      })
    ).rejects.toThrow(ForbiddenError)
    expect(mockClear).not.toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('rejects when actor.role is missing/empty with ForbiddenError', async () => {
    await expect(
      clearTenantAutoQualityFlags({
        restaurantId: 'rest-1',
        actor: { userId: 'admin-1', role: '' },
      })
    ).rejects.toThrow(ForbiddenError)
    expect(mockClear).not.toHaveBeenCalled()
  })

  it('allows platform_admin actor', async () => {
    await expect(
      clearTenantAutoQualityFlags({
        restaurantId: 'rest-1',
        actor: { userId: 'admin-1', role: 'platform_admin' },
      })
    ).resolves.toBeUndefined()
    expect(mockClear).toHaveBeenCalledWith('rest-1')
  })

  it('audit log records the actor role', async () => {
    await clearTenantAutoQualityFlags({
      restaurantId: 'rest-2',
      actor: { userId: 'admin-2', role: 'platform_admin' },
    })

    const call = mockAudit.mock.calls[0][0]
    expect(call.details).toMatchObject({ actorRole: 'platform_admin' })
  })

  it('does not audit if the repo write fails', async () => {
    mockClear.mockRejectedValueOnce(new Error('db down'))
    await expect(
      clearTenantAutoQualityFlags({
        restaurantId: 'rest-1',
        actor: { userId: 'admin-1', role: 'platform_admin' },
      })
    ).rejects.toThrow(/db down/)
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
