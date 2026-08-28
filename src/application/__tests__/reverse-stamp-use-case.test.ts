import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/stamp-repository', () => ({
  reverseStamp: vi.fn(),
}))

import { reverseStampUseCase } from '@/application/reverse-stamp-use-case'
import { reverseStamp } from '@/infrastructure/supabase/repositories/stamp-repository'

const baseParams = {
  restaurantId: 'r-1',
  memberId: 'm-1',
  campaignId: 'c-1',
  actorUserId: 'u-1',
}

describe('reverseStampUseCase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps a reversed outcome', async () => {
    vi.mocked(reverseStamp).mockResolvedValue({
      outcome: 'reversed',
      stampsCount: 6,
      stampsRequired: 10,
      cardId: 'card-1',
    })

    const result = await reverseStampUseCase(baseParams)

    expect(result).toEqual({ outcome: 'reversed', stampsCount: 6, stampsRequired: 10 })
    expect(reverseStamp).toHaveBeenCalledWith(baseParams)
  })

  it('maps an at_zero no-op outcome', async () => {
    vi.mocked(reverseStamp).mockResolvedValue({
      outcome: 'at_zero',
      stampsCount: 0,
      stampsRequired: 10,
      cardId: 'card-1',
    })

    const result = await reverseStampUseCase(baseParams)

    expect(result).toEqual({ outcome: 'at_zero', stampsCount: 0, stampsRequired: 10 })
  })
})
