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
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'active',
    failureReason: null,
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
  preferred_language: null,
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

/**
 * Wire the three sequential `from()` calls of the tag branch:
 *   1. campaign_tags → select('tag_id').eq('campaign_id')       → tagRows
 *   2. member_tags   → select('member_id').eq('restaurant_id').in('tag_id') → memberTagRows
 *   3. members       → select(cols).eq('restaurant_id').eq('status','active').in('id') → memberRows
 * Extra queued mocks are harmless when the branch returns early.
 */
function setupTagChain(opts: {
  tagRows: { tag_id: string }[]
  memberTagRows?: { member_id: string }[]
  memberRows?: Record<string, unknown>[]
}) {
  // clearAllMocks (beforeEach) does NOT flush the mockReturnValueOnce queue, so
  // reset here to drop any unconsumed queued mocks from an early-returning test.
  mockFrom.mockReset()
  const campaignTagsEq = vi
    .fn()
    .mockResolvedValue({ data: opts.tagRows, error: null })
  const memberTagsIn = vi
    .fn()
    .mockResolvedValue({ data: opts.memberTagRows ?? [], error: null })
  const memberTagsEq = vi.fn().mockReturnValue({ in: memberTagsIn })
  const membersIn = vi
    .fn()
    .mockResolvedValue({ data: opts.memberRows ?? [], error: null })
  const membersStatusEq = vi.fn().mockReturnValue({ in: membersIn })
  const membersEq = vi.fn().mockReturnValue({ eq: membersStatusEq })

  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({ eq: campaignTagsEq }),
  })
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({ eq: memberTagsEq }),
  })
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({ eq: membersEq }),
  })

  return {
    campaignTagsEq,
    memberTagsEq,
    memberTagsIn,
    membersEq,
    membersStatusEq,
    membersIn,
  }
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

  it('maps preferred_language onto the Member shape', async () => {
    const campaign = buildCampaign({ type: 'promo', targetAudience: 'all' })

    setupChain({
      data: [{ ...memberRow, preferred_language: 'en' }],
      error: null,
    })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result[0].preferredLanguage).toBe('en')
  })

  it('maps WAQ-007 cooldown columns (pmm_throttled_until, unreachable_at) onto the Member shape', async () => {
    const campaign = buildCampaign({ type: 'promo', targetAudience: 'all' })

    setupChain({
      data: [
        {
          ...memberRow,
          pmm_throttled_until: '2026-12-31T00:00:00.000Z',
          unreachable_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      error: null,
    })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result[0].pmmThrottledUntil).toBe('2026-12-31T00:00:00.000Z')
    expect(result[0].unreachableAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('defaults the WAQ-007 cooldown columns to null when absent from the row', async () => {
    const campaign = buildCampaign({ type: 'promo', targetAudience: 'all' })
    setupChain({ data: [memberRow], error: null })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result[0].pmmThrottledUntil).toBeNull()
    expect(result[0].unreachableAt).toBeNull()
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

  it('resolves members carrying a linked tag (tag branch)', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    setupTagChain({
      tagRows: [{ tag_id: 't-1' }],
      memberTagRows: [{ member_id: 'm-1' }],
      memberRows: [memberRow],
    })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('m-1')
    expect(mockFrom).toHaveBeenCalledWith('campaign_tags')
    expect(mockFrom).toHaveBeenCalledWith('member_tags')
    expect(mockFrom).toHaveBeenCalledWith('members')
  })

  it('includes a member tagged AFTER campaign creation (dynamic membership)', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    // The tag link existed at create time; m-2 was tagged later. Because the
    // branch reads member_tags live at send time, m-2 is resolved.
    setupTagChain({
      tagRows: [{ tag_id: 't-1' }],
      memberTagRows: [{ member_id: 'm-2' }],
      memberRows: [{ ...memberRow, id: 'm-2', name: 'Newbie' }],
    })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('m-2')
  })

  it('resolves to [] when the linked tag has 0 members (no error, no members query)', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    setupTagChain({ tagRows: [{ tag_id: 't-1' }], memberTagRows: [] })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toEqual([])
    expect(mockFrom).toHaveBeenCalledWith('member_tags')
    expect(mockFrom).not.toHaveBeenCalledWith('members')
  })

  it('resolves to [] when the campaign has no linked tags (no member_tags query)', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    setupTagChain({ tagRows: [] })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toEqual([])
    expect(mockFrom).toHaveBeenCalledWith('campaign_tags')
    expect(mockFrom).not.toHaveBeenCalledWith('member_tags')
  })

  it('does not resolve a cross-tenant tag: member_tags is scoped by restaurant_id', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    // member_tags scoped to r-1 returns nothing — the tag's members live in
    // another tenant, so nothing is resolved.
    const mocks = setupTagChain({
      tagRows: [{ tag_id: 't-1' }],
      memberTagRows: [],
    })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toEqual([])
    expect(mocks.memberTagsEq).toHaveBeenCalledWith('restaurant_id', 'r-1')
  })

  it('dedups a member that carries two linked tags', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    const mocks = setupTagChain({
      tagRows: [{ tag_id: 't-1' }, { tag_id: 't-2' }],
      memberTagRows: [{ member_id: 'm-1' }, { member_id: 'm-1' }],
      memberRows: [memberRow],
    })

    const result = await resolveTargetMembers(campaign, 'r-1')

    // Deduped to a single id before the members lookup.
    expect(mocks.membersIn).toHaveBeenCalledWith('id', ['m-1'])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('m-1')
  })

  it('chunks fetchMembersByIds at 500 ids per .in() and concatenates every chunk (B4.4)', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    const memberIds = Array.from({ length: 1200 }, (_, i) => `m-${i}`)

    mockFrom.mockReset()
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{ tag_id: 't-1' }], error: null }),
      }),
    })
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: memberIds.map((id) => ({ member_id: id })),
            error: null,
          }),
        }),
      }),
    })
    const membersInCalls: string[][] = []
    const membersIn = vi.fn((_col: string, ids: string[]) => {
      membersInCalls.push(ids)
      return Promise.resolve({
        data: ids.map((id) => ({ ...memberRow, id })),
        error: null,
      })
    })
    const membersStatusEq = vi.fn().mockReturnValue({ in: membersIn })
    const membersEq = vi.fn().mockReturnValue({ eq: membersStatusEq })
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: membersEq }),
    })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(membersInCalls).toHaveLength(3)
    expect(membersInCalls[0]).toHaveLength(500)
    expect(membersInCalls[1]).toHaveLength(500)
    expect(membersInCalls[2]).toHaveLength(200)
    expect(result).toHaveLength(1200)
    expect(new Set(result.map((m) => m.id)).size).toBe(1200)
  })

  it('filters the tag branch to active members only (fetchMembersByIds status filter)', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    const mocks = setupTagChain({
      tagRows: [{ tag_id: 't-1' }],
      memberTagRows: [{ member_id: 'm-inactive' }],
      // The real query applies .eq('status', 'active') server-side, so an
      // unsubscribed member's row never comes back even though it carries
      // the tag.
      memberRows: [],
    })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toEqual([])
    expect(mocks.membersEq).toHaveBeenCalledWith('restaurant_id', 'r-1')
    expect(mocks.membersStatusEq).toHaveBeenCalledWith('status', 'active')
  })
})
