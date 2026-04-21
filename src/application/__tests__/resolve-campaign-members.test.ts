import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'

const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockLt = vi.fn()
const mockIn = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ from: mockFrom })),
}))

import { resolveTargetMembers } from '@/application/resolve-campaign-members'

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    restaurantId: 'r-1',
    name: 'Test Campaign',
    type: 'promo',
    template: 'Hello {{name}}',
    templateEn: null,
    templateZhHk: null,
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'active',
    isChargeable: true,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: null,
    targetAudience: 'all',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const memberRow = {
  id: 'm-1',
  restaurant_id: 'r-1',
  phone: '85291234567',
  name: 'Alice',
  points_balance: 100,
  status: 'active',
  joined_at: '2024-01-01T00:00:00Z',
  last_visit_at: null,
}

function setupChain(result: { data: unknown[]; error: null }) {
  const thenable = {
    eq: mockEq,
    lt: mockLt,
    in: mockIn,
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  mockFrom.mockReturnValue({ select: mockSelect })
  mockSelect.mockReturnValue(thenable)
  mockEq.mockReturnValue(thenable)
  mockLt.mockReturnValue(thenable)
  mockIn.mockReturnValue(thenable)
}

describe('resolveTargetMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches selected members via campaign_members join', async () => {
    const campaign = buildCampaign({ targetAudience: 'selected' })

    // First call: campaign_members query
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [{ member_id: 'm-1' }, { member_id: 'm-2' }],
          error: null,
        }),
      }),
    })

    // Second call: members query
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [memberRow, { ...memberRow, id: 'm-2', name: 'Bob' }],
            error: null,
          }),
        }),
      }),
    })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toHaveLength(2)
    expect(mockFrom).toHaveBeenCalledWith('campaign_members')
    expect(mockFrom).toHaveBeenCalledWith('members')
  })

  it('fetches active members for promo campaigns', async () => {
    const campaign = buildCampaign({ type: 'promo', targetAudience: 'all' })

    setupChain({ data: [memberRow], error: null })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('m-1')
    expect(mockFrom).toHaveBeenCalledWith('members')
  })

  it('fetches winback members with last_visit_at before cutoff', async () => {
    const campaign = buildCampaign({
      type: 'winback',
      targetAudience: 'all',
      schedule: { inactiveDays: 60 },
    })

    const oldVisitRow = {
      ...memberRow,
      last_visit_at: '2023-01-01T00:00:00Z',
    }

    setupChain({ data: [oldVisitRow], error: null })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toHaveLength(1)
    expect(mockFrom).toHaveBeenCalledWith('members')
  })

  it('returns empty array for birthday campaigns', async () => {
    const campaign = buildCampaign({ type: 'birthday', targetAudience: 'all' })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
