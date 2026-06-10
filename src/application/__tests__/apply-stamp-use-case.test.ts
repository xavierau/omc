import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/stamp-repository', () => ({
  applyStamp: vi.fn(),
}))

vi.mock('@/application/complete-stamp-card', () => ({
  completeStampCardUseCase: vi.fn(),
}))

import { applyStampUseCase } from '@/application/apply-stamp-use-case'
import { applyStamp } from '@/infrastructure/supabase/repositories/stamp-repository'
import { completeStampCardUseCase } from '@/application/complete-stamp-card'

const baseParams = {
  restaurantId: 'r-1',
  memberId: 'm-1',
  campaignId: 'c-1',
  actorUserId: 'u-1',
  maxPerDay: 1,
  phone: '85291234567',
  phoneNumberId: 'phone-id-1',
  language: 'en' as const,
}

describe('applyStampUseCase', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps a stamped outcome and does NOT mint a reward', async () => {
    vi.mocked(applyStamp).mockResolvedValue({
      outcome: 'stamped',
      stampsCount: 7,
      stampsRequired: 10,
      cardId: 'card-1',
      completed: false,
    })

    const result = await applyStampUseCase(baseParams)

    expect(result).toEqual({
      outcome: 'stamped',
      stampsCount: 7,
      stampsRequired: 10,
      completed: false,
    })
    expect(completeStampCardUseCase).not.toHaveBeenCalled()
  })

  it('maps already_stamped_today and mints nothing', async () => {
    vi.mocked(applyStamp).mockResolvedValue({
      outcome: 'already_stamped_today',
      stampsCount: 7,
      stampsRequired: 10,
      cardId: 'card-1',
      completed: false,
    })

    const result = await applyStampUseCase(baseParams)

    expect(result.outcome).toBe('already_stamped_today')
    expect(result.completed).toBe(false)
    expect(completeStampCardUseCase).not.toHaveBeenCalled()
  })

  it('triggers mint+send and card reset on completion', async () => {
    vi.mocked(applyStamp).mockResolvedValue({
      outcome: 'stamped',
      stampsCount: 10,
      stampsRequired: 10,
      cardId: 'card-1',
      completed: true,
    })

    const result = await applyStampUseCase(baseParams)

    expect(result).toEqual({
      outcome: 'stamped',
      stampsCount: 10,
      stampsRequired: 10,
      completed: true,
    })
    expect(completeStampCardUseCase).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      memberId: 'm-1',
      campaignId: 'c-1',
      cardId: 'card-1',
      phone: '85291234567',
      phoneNumberId: 'phone-id-1',
      language: 'en',
    })
  })

  it('does not let a mint/notify failure roll back the committed stamp', async () => {
    vi.mocked(applyStamp).mockResolvedValue({
      outcome: 'stamped',
      stampsCount: 10,
      stampsRequired: 10,
      cardId: 'card-1',
      completed: true,
    })
    vi.mocked(completeStampCardUseCase).mockRejectedValue(new Error('Kapso down'))

    const result = await applyStampUseCase(baseParams)

    expect(result.completed).toBe(true)
    expect(result.outcome).toBe('stamped')
  })
})
