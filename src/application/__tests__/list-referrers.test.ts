import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/referrer-repository')

import {
  listReferrers,
  listActiveReferrers,
} from '@/infrastructure/supabase/repositories/referrer-repository'
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

describe('listReferrersUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all referrers when no status filter', async () => {
    const referrers = [buildReferrer(), buildReferrer({ id: 'ref-2' })]
    vi.mocked(listReferrers).mockResolvedValue(referrers)

    const result = await listReferrersUseCase()

    expect(result).toEqual(referrers)
    expect(listReferrers).toHaveBeenCalled()
    expect(listActiveReferrers).not.toHaveBeenCalled()
  })

  it('returns active referrers when status is active', async () => {
    const active = [buildReferrer()]
    vi.mocked(listActiveReferrers).mockResolvedValue(active)

    const result = await listReferrersUseCase({ status: 'active' })

    expect(result).toEqual(active)
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

    expect(result).toEqual([all[1]])
    expect(listReferrers).toHaveBeenCalled()
  })
})
