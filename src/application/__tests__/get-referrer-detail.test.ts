import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/referrer-repository')
vi.mock(
  '@/infrastructure/supabase/repositories/referrer-commission-repository'
)

import { findReferrerById } from '@/infrastructure/supabase/repositories/referrer-repository'
import {
  getReferrerEarnings,
  listByReferrer,
} from '@/infrastructure/supabase/repositories/referrer-commission-repository'
import { getReferrerDetailUseCase } from '../get-referrer-detail'
import type { Referrer } from '@/domain/entities/referrer'
import type { ReferrerCommission } from '@/domain/entities/referrer-commission'

function buildReferrer(overrides: Partial<Referrer> = {}): Referrer {
  return {
    id: 'ref-1',
    name: 'Acme Corp',
    contactEmail: 'acme@example.com',
    contactPhone: null,
    commissionPerMessageHkd: 0.05,
    commissionPerRedemptionHkd: 0.10,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function buildCommission(
  overrides: Partial<ReferrerCommission> = {}
): ReferrerCommission {
  return {
    id: 'comm-1',
    referrerId: 'ref-1',
    month: '2026-01',
    tenantId: 'tenant-1',
    tenantName: 'Restaurant A',
    messagesSent: 500,
    commissionPerMessage: 0.05,
    redemptionsCount: 0,
    commissionPerRedemption: 0.10,
    broadcastCommission: 25,
    redemptionCommission: 0,
    totalCommission: 25,
    status: 'pending',
    paidAt: null,
    createdAt: '2026-01-31T00:00:00Z',
    updatedAt: '2026-01-31T00:00:00Z',
    ...overrides,
  }
}

describe('getReferrerDetailUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when referrer not found', async () => {
    vi.mocked(findReferrerById).mockResolvedValue(null)

    const result = await getReferrerDetailUseCase('ref-missing')

    expect(result).toBeNull()
    expect(getReferrerEarnings).not.toHaveBeenCalled()
    expect(listByReferrer).not.toHaveBeenCalled()
  })

  it('returns detail with dual-stream earnings and commissions', async () => {
    const referrer = buildReferrer()
    const earnings = {
      total: 100,
      pending: 25,
      totalBroadcast: 70,
      totalRedemption: 30,
    }
    const commissions = [buildCommission()]

    vi.mocked(findReferrerById).mockResolvedValue(referrer)
    vi.mocked(getReferrerEarnings).mockResolvedValue(earnings)
    vi.mocked(listByReferrer).mockResolvedValue(commissions)

    const result = await getReferrerDetailUseCase('ref-1')

    expect(result).toEqual({
      referrer,
      earnings,
      recentCommissions: commissions,
    })
    expect(getReferrerEarnings).toHaveBeenCalledWith('ref-1')
    expect(listByReferrer).toHaveBeenCalledWith('ref-1')
  })
})
