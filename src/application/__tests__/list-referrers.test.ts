import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/referrer-repository')
vi.mock(
  '@/infrastructure/supabase/repositories/referrer-commission-repository'
)

import {
  listReferrers,
  listActiveReferrers,
} from '@/infrastructure/supabase/repositories/referrer-repository'
import { listEarningsByReferrer } from '@/infrastructure/supabase/repositories/referrer-commission-repository'
import { listReferrersUseCase } from '../list-referrers'
import type { Referrer } from '@/domain/entities/referrer'

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

function zeroEarnings() {
  return { total: 0, pending: 0, totalBroadcast: 0, totalRedemption: 0 }
}

describe('listReferrersUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listEarningsByReferrer).mockResolvedValue(new Map())
  })

  it('returns all referrers with empty earnings when none recorded', async () => {
    const referrers = [buildReferrer(), buildReferrer({ id: 'ref-2' })]
    vi.mocked(listReferrers).mockResolvedValue(referrers)

    const result = await listReferrersUseCase()

    expect(result).toEqual([
      { ...referrers[0], earnings: zeroEarnings() },
      { ...referrers[1], earnings: zeroEarnings() },
    ])
    expect(listReferrers).toHaveBeenCalled()
    expect(listActiveReferrers).not.toHaveBeenCalled()
  })

  it('returns active referrers when status is active', async () => {
    const active = [buildReferrer()]
    vi.mocked(listActiveReferrers).mockResolvedValue(active)

    const result = await listReferrersUseCase({ status: 'active' })

    expect(result).toEqual([{ ...active[0], earnings: zeroEarnings() }])
    expect(listActiveReferrers).toHaveBeenCalled()
    expect(listReferrers).not.toHaveBeenCalled()
  })

  it('returns only inactive referrers when status is inactive', async () => {
    const all = [
      buildReferrer({ id: 'ref-1', status: 'active' }),
      buildReferrer({ id: 'ref-2', status: 'inactive' }),
    ]
    vi.mocked(listReferrers).mockResolvedValue(all)

    const result = await listReferrersUseCase({ status: 'inactive' })

    expect(result).toEqual([{ ...all[1], earnings: zeroEarnings() }])
    expect(listReferrers).toHaveBeenCalled()
  })

  it('attaches per-referrer dual-stream earnings', async () => {
    const referrers = [
      buildReferrer({ id: 'ref-1' }),
      buildReferrer({ id: 'ref-2' }),
    ]
    vi.mocked(listReferrers).mockResolvedValue(referrers)
    vi.mocked(listEarningsByReferrer).mockResolvedValue(
      new Map([
        [
          'ref-1',
          { total: 50, pending: 20, totalBroadcast: 30, totalRedemption: 20 },
        ],
      ])
    )

    const result = await listReferrersUseCase()

    expect(result[0].earnings).toEqual({
      total: 50,
      pending: 20,
      totalBroadcast: 30,
      totalRedemption: 20,
    })
    expect(result[1].earnings).toEqual(zeroEarnings())
  })
})
