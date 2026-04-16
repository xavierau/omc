import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/referrer-commission-repository'
)

import { markPaid } from '@/infrastructure/supabase/repositories/referrer-commission-repository'
import { markCommissionPaidUseCase } from '../mark-commission-paid'
import type { ReferrerCommission } from '@/domain/entities/referrer-commission'

function buildCommission(
  overrides: Partial<ReferrerCommission> = {}
): ReferrerCommission {
  return {
    id: 'comm-1',
    referrerId: 'ref-1',
    month: '2026-04',
    tenantId: 'tenant-1',
    tenantName: 'Acme Corp',
    messagesSent: 100,
    commissionPerMessage: 0.05,
    redemptionsCount: 0,
    commissionPerRedemption: 0.10,
    broadcastCommission: 5,
    redemptionCommission: 0,
    totalCommission: 5,
    status: 'paid',
    paidAt: '2026-04-12T00:00:00Z',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
    ...overrides,
  }
}

describe('markCommissionPaidUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns success with updated commission', async () => {
    const expected = buildCommission()
    vi.mocked(markPaid).mockResolvedValue(expected)

    const result = await markCommissionPaidUseCase('comm-1')

    expect(result).toEqual({ success: true, commission: expected })
    expect(markPaid).toHaveBeenCalledWith('comm-1')
  })

  it('returns failure when repository throws', async () => {
    vi.mocked(markPaid).mockRejectedValue(
      new Error('Commission not found')
    )

    const result = await markCommissionPaidUseCase('bad-id')

    expect(result).toEqual({
      success: false,
      message: 'Failed to mark commission as paid',
    })
  })

  it('returns the commission with paid status and paidAt', async () => {
    const expected = buildCommission({
      status: 'paid',
      paidAt: '2026-04-12T10:00:00Z',
    })
    vi.mocked(markPaid).mockResolvedValue(expected)

    const result = await markCommissionPaidUseCase('comm-1')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.commission.status).toBe('paid')
      expect(result.commission.paidAt).toBe('2026-04-12T10:00:00Z')
    }
  })
})
