import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/stamp-campaign-repository')
vi.mock(
  '@/infrastructure/supabase/repositories/stamp-campaign-write-repository',
  async () => {
    // Keep the real StampCampaignUniqueViolationError so the use case's
    // `instanceof` check matches when the test simulates the one-active conflict.
    const actual = await vi.importActual<
      typeof import('@/infrastructure/supabase/repositories/stamp-campaign-write-repository')
    >('@/infrastructure/supabase/repositories/stamp-campaign-write-repository')
    return { ...actual, createStampCampaign: vi.fn(), setStampCampaignStatus: vi.fn() }
  }
)

import { getStampCampaignById } from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import {
  setStampCampaignStatus,
  StampCampaignUniqueViolationError,
} from '@/infrastructure/supabase/repositories/stamp-campaign-write-repository'
import {
  transitionStampCampaignUseCase,
  OneActiveCampaignError,
} from '../transition-stamp-campaign-use-case'
import { StampCampaignNotFoundError } from '../stamp-campaign-errors'

function view(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    restaurantId: 'r-1',
    name: 'Coffee Card',
    nameZh: null,
    stampsRequired: 10,
    rewardId: 'rw-1',
    status: 'draft' as const,
    maxStampsPerDay: 1,
    honorUntil: null,
    ...overrides,
  }
}

const REQ = { id: 'c-1', restaurantId: 'r-1' }

describe('transitionStampCampaignUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getStampCampaignById).mockResolvedValue(view())
    vi.mocked(setStampCampaignStatus).mockImplementation(async (p) => view({ status: p.status }))
  })

  it('throws StampCampaignNotFoundError when the campaign is not in the tenant', async () => {
    vi.mocked(getStampCampaignById).mockResolvedValue(null)

    await expect(
      transitionStampCampaignUseCase({ ...REQ, action: 'activate' })
    ).rejects.toBeInstanceOf(StampCampaignNotFoundError)
    expect(setStampCampaignStatus).not.toHaveBeenCalled()
  })

  it('activate: writes status=active', async () => {
    const result = await transitionStampCampaignUseCase({ ...REQ, action: 'activate' })

    expect(setStampCampaignStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-1', restaurantId: 'r-1', status: 'active' })
    )
    expect(result.status).toBe('active')
  })

  it('activate: maps the one-active unique violation to OneActiveCampaignError', async () => {
    vi.mocked(setStampCampaignStatus).mockRejectedValue(
      new StampCampaignUniqueViolationError('uq_stamp_campaigns_one_active', 'dup')
    )

    await expect(
      transitionStampCampaignUseCase({ ...REQ, action: 'activate' })
    ).rejects.toBeInstanceOf(OneActiveCampaignError)
  })

  it('pause: writes status=paused', async () => {
    vi.mocked(getStampCampaignById).mockResolvedValue(view({ status: 'active' }))

    await transitionStampCampaignUseCase({ ...REQ, action: 'pause' })

    expect(setStampCampaignStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paused' })
    )
  })

  it('end: writes status=ended AND honor_until ~14 days out', async () => {
    vi.mocked(getStampCampaignById).mockResolvedValue(view({ status: 'active' }))

    await transitionStampCampaignUseCase({ ...REQ, action: 'end' })

    const call = vi.mocked(setStampCampaignStatus).mock.calls[0][0]
    expect(call.status).toBe('ended')
    expect(call.honorUntil).toBeDefined()
    const days = (new Date(call.honorUntil!).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(13.9)
    expect(days).toBeLessThan(14.1)
  })
})
