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
 * member_tags is read through `.order().order().range(from, to)` in a loop
 * (review I-5(a)), so the mock has to slice like PostgREST does — a mock that
 * replayed the whole set for every page would never produce the empty page
 * that ends the loop.
 *
 * `maxRows` simulates a project whose PostgREST `max-rows` is BELOW the page
 * size: the server silently returns fewer rows than the requested range
 * (review round 2, #2).
 */
function pagingRange(rows: { member_id: string }[], maxRows = Infinity) {
  const pages: Array<[number, number]> = []
  const orderedColumns: string[] = []
  const range = vi.fn((from: number, to: number) => {
    pages.push([from, to])
    const size = Math.min(to - from + 1, maxRows)
    return Promise.resolve({ data: rows.slice(from, from + size), error: null })
  })
  const chain: Record<string, unknown> = { range }
  chain.order = vi.fn((column: string) => {
    orderedColumns.push(column)
    return chain
  })
  return { pages, orderedColumns, range, chain }
}

/**
 * Tag branch wired by TABLE rather than by call order, because the paged
 * member_tags read issues one `from('member_tags')` per page — a queue of
 * `mockReturnValueOnce`s runs out on page 2. The members lookup echoes back
 * whatever ids each chunk asked for, so chunking is observable.
 */
function setupPagedTagChain(memberIds: string[], maxRows = Infinity) {
  const paging = pagingRange(memberIds.map((id) => ({ member_id: id })), maxRows)
  const memberTagsIn = vi.fn().mockReturnValue(paging.chain)
  const memberTagsEq = vi.fn().mockReturnValue({ in: memberTagsIn })
  const membersIn = vi.fn((_col: string, ids: string[]) =>
    Promise.resolve({ data: ids.map((id) => ({ ...memberRow, id })), error: null })
  )
  mockFrom.mockReset()
  mockFrom.mockImplementation((table: string) => {
    if (table === 'campaign_tags') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ tag_id: 't-1' }], error: null }),
        }),
      }
    }
    if (table === 'member_tags') {
      return { select: vi.fn().mockReturnValue({ eq: memberTagsEq }) }
    }
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ in: membersIn }) }),
      }),
    }
  })
  return { paging, memberTagsEq, memberTagsIn, membersIn }
}

/**
 * Wire the three tables of the tag branch:
 *   campaign_tags → select('tag_id').eq('campaign_id')       → tagRows
 *   member_tags   → select('member_id').eq('restaurant_id').in('tag_id')
 *                     .order().order().range()               → memberTagRows
 *   members       → select(cols).eq('restaurant_id').eq('status','active').in('id') → memberRows
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
  const memberTagsPaging = pagingRange(opts.memberTagRows ?? [])
  const memberTagsIn = vi.fn().mockReturnValue(memberTagsPaging.chain)
  const memberTagsEq = vi.fn().mockReturnValue({ in: memberTagsIn })
  const membersIn = vi
    .fn()
    .mockResolvedValue({ data: opts.memberRows ?? [], error: null })
  const membersStatusEq = vi.fn().mockReturnValue({ in: membersIn })
  const membersEq = vi.fn().mockReturnValue({ eq: membersStatusEq })

  // Wired by TABLE, not by call order: the paged member_tags read always ends
  // on an EMPTY page, so it issues at least two `from('member_tags')` calls and
  // a queue of `mockReturnValueOnce`s would hand page 2 the members mock.
  mockFrom.mockImplementation((table: string) => {
    if (table === 'campaign_tags') {
      return { select: vi.fn().mockReturnValue({ eq: campaignTagsEq }) }
    }
    if (table === 'member_tags') {
      return { select: vi.fn().mockReturnValue({ eq: memberTagsEq }) }
    }
    return { select: vi.fn().mockReturnValue({ eq: membersEq }) }
  })

  return {
    campaignTagsEq,
    memberTagsEq,
    memberTagsIn,
    memberTagsPages: memberTagsPaging.pages,
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

    const mocks = setupPagedTagChain(memberIds)

    const result = await resolveTargetMembers(campaign, 'r-1')

    const membersInCalls = mocks.membersIn.mock.calls.map(([, ids]) => ids)
    expect(membersInCalls).toHaveLength(3)
    expect(membersInCalls[0]).toHaveLength(500)
    expect(membersInCalls[1]).toHaveLength(500)
    expect(membersInCalls[2]).toHaveLength(200)
    expect(result).toHaveLength(1200)
    expect(new Set(result.map((m) => m.id)).size).toBe(1200)
  })

  it('pages the member_tags read at 1000 rows so ids past max-rows still send (I-5a)', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    const memberIds = Array.from({ length: 2500 }, (_, i) => `m-${i}`)
    const mocks = setupPagedTagChain(memberIds)

    const result = await resolveTargetMembers(campaign, 'r-1')

    // 2,500 rows = two full pages, a 500-row page, then the empty page that
    // ends the loop. The cursor advances by rows RECEIVED, so the last request
    // resumes at 2500 rather than at the requested page boundary.
    expect(mocks.paging.pages).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [2500, 3499],
    ])
    // Tenant scoping and the tag predicate survive the rewrite.
    expect(mocks.memberTagsEq).toHaveBeenCalledWith('restaurant_id', 'r-1')
    expect(mocks.memberTagsIn).toHaveBeenCalledWith('tag_id', ['t-1'])
    // Every id past the max-rows cap is resolved, not just the first page.
    expect(result).toHaveLength(2500)
    expect(new Set(result.map((m) => m.id)).size).toBe(2500)
  })

  it('orders the paged read by the member_tags primary key before .range()', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    const mocks = setupPagedTagChain(['m-1', 'm-2'])

    await resolveTargetMembers(campaign, 'r-1')

    // Without a total order, PostgREST may return rows in a different order
    // per request, so a `.range()` walk can repeat or skip rows (round 2, #2).
    // EVERY page request must carry the full primary-key order, not just the first.
    expect(mocks.paging.orderedColumns).toEqual(
      mocks.paging.pages.flatMap(() => ['member_id', 'tag_id'])
    )
  })

  it('stops paging on the empty page when the row count is an exact multiple of the page size', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    const mocks = setupPagedTagChain(Array.from({ length: 1000 }, (_, i) => `m-${i}`))

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(mocks.paging.pages).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(result).toHaveLength(1000)
  })

  it('resolves every row when the project max-rows is BELOW the page size', async () => {
    const campaign = buildCampaign({ targetAudience: 'tag' })
    // 1,200 rows on a project capped at 500 rows per request: a loop that
    // stopped on a short page would return 500; one that advanced by pageSize
    // would silently SKIP rows 500-999.
    const mocks = setupPagedTagChain(
      Array.from({ length: 1200 }, (_, i) => `m-${i}`),
      500
    )

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(mocks.paging.pages).toEqual([
      [0, 999],
      [500, 1499],
      [1000, 1999],
      [1200, 2199],
    ])
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
