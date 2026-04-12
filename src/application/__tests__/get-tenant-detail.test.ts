import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/restaurant-admin-repository')
vi.mock('@/infrastructure/supabase/repositories/user-tenant-repository')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { findById } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { listByRestaurantId } from '@/infrastructure/supabase/repositories/user-tenant-repository'
import { getTenantDetail } from '../get-tenant-detail'

const TENANT_ROW = {
  id: 't-1',
  slug: 'pizza-place',
  name: 'Pizza Place',
  whatsapp_number: '+85291234567',
  kapso_phone_number_id: 'kp-1',
  meta_business_account_id: 'mba-1',
  status: 'active',
  trial_expires_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

function buildMockSupabase(counts: { members: number; receipts: number; redemptions: number }) {
  const tableResults: Record<string, { count: number }> = {
    members: { count: counts.members },
    receipts: { count: counts.receipts },
    coupon_redemptions: { count: counts.redemptions },
  }

  const mockFrom = vi.fn().mockImplementation((table: string) => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(tableResults[table] ?? { count: 0 }),
    }),
  }))

  const mockGetUserById = vi.fn()

  return {
    from: mockFrom,
    auth: { admin: { getUserById: mockGetUserById } },
    mockGetUserById,
  }
}

describe('getTenantDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when tenant is not found', async () => {
    vi.mocked(findById).mockResolvedValue(null as never)

    const result = await getTenantDetail('non-existent')

    expect(result).toBeNull()
    expect(listByRestaurantId).not.toHaveBeenCalled()
  })

  it('maps tenant, resolves user emails, and computes metrics', async () => {
    vi.mocked(findById).mockResolvedValue(TENANT_ROW as never)
    vi.mocked(listByRestaurantId).mockResolvedValue([
      { user_id: 'u-1', role: 'owner', created_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u-2', role: 'staff', created_at: '2026-02-01T00:00:00Z' },
    ] as never)

    const mock = buildMockSupabase({ members: 25, receipts: 100, redemptions: 10 })
    mock.mockGetUserById
      .mockResolvedValueOnce({ data: { user: { email: 'owner@test.com' } } })
      .mockResolvedValueOnce({ data: { user: { email: 'staff@test.com' } } })

    vi.mocked(createServerSupabaseClient).mockReturnValue(mock as never)

    const result = await getTenantDetail('t-1')

    expect(result).not.toBeNull()
    expect(result!.tenant.id).toBe('t-1')
    expect(result!.tenant.name).toBe('Pizza Place')
    expect(result!.tenant.whatsappNumber).toBe('+85291234567')
    expect(result!.tenant.status).toBe('active')
    expect(result!.tenant.createdAt).toBe('2026-01-01T00:00:00Z')

    expect(result!.users).toHaveLength(2)
    expect(result!.users[0]).toEqual({
      id: 'u-1',
      email: 'owner@test.com',
      role: 'owner',
      createdAt: '2026-01-01T00:00:00Z',
    })
    expect(result!.users[1].email).toBe('staff@test.com')

    expect(result!.metrics.memberCount).toBe(25)
    expect(result!.metrics.receiptCount).toBe(100)
    expect(result!.metrics.couponRedemptions).toBe(10)
  })

  it('returns empty users array when no user-tenants exist', async () => {
    vi.mocked(findById).mockResolvedValue(TENANT_ROW as never)
    vi.mocked(listByRestaurantId).mockResolvedValue([] as never)

    const mock = buildMockSupabase({ members: 0, receipts: 0, redemptions: 0 })
    vi.mocked(createServerSupabaseClient).mockReturnValue(mock as never)

    const result = await getTenantDetail('t-1')

    expect(result).not.toBeNull()
    expect(result!.users).toEqual([])
    expect(mock.mockGetUserById).not.toHaveBeenCalled()
  })
})
