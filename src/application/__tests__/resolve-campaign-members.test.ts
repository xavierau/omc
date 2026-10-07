import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'

const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
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

function memberRows(ids: string[]): Record<string, unknown>[] {
  return ids.map((id) => ({ ...memberRow, id }))
}

interface TablePage {
  filters: Array<[string, string, unknown]>
  ordered: string[]
  range: [number, number]
}

/**
 * A `from('members').select(...)` chain that windows like PostgREST does:
 * `.range(from, to)` resolves to THAT slice, so the walk ends on an empty
 * page. A mock that replayed the whole set on every call would never
 * terminate -- which is the shape of the bug this replaces: the promo and
 * winback branches issued an UNPAGED select, silently truncated at the
 * project's `max-rows` (review F1).
 *
 * Each page records the filters it applied and the columns it ordered by, so
 * a test can claim that the winback cutoff is re-applied on page 2 as much as
 * on page 1, and that the walk carries the total order readAllPages requires.
 */
function setupChain(result: { data: unknown[]; error: null }) {
  const rows = result.data as Record<string, unknown>[]
  const pages: TablePage[] = []
  mockFrom.mockReset()
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'members') {
      throw new Error(`unexpected from('${table}'): this branch reads members`)
    }
    return { select: mockSelect }
  })
  mockSelect.mockImplementation(() => {
    const page: TablePage = { filters: [], ordered: [], range: [0, -1] }
    const chain = {
      eq(column: string, value: unknown) {
        page.filters.push(['eq', column, value])
        return chain
      },
      lt(column: string, value: unknown) {
        page.filters.push(['lt', column, value])
        return chain
      },
      order(column: string) {
        page.ordered.push(column)
        return chain
      },
      range(from: number, to: number) {
        page.range = [from, to]
        pages.push(page)
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
      },
    }
    return chain
  })
  return { pages }
}

interface RpcArgs {
  p_restaurant_id: string
  p_limit: number
  p_offset: number
  p_tag_ids?: string[]
  p_campaign_id?: string
}

/**
 * Both recipient branches page a set-returning RPC (migration 079) with
 * p_limit/p_offset instead of shipping member UUIDs back through a URL
 * filter (#162 — PostgREST echoes the query in `content-location` and undici
 * aborts above ~390 ids). The mock has to slice like PostgREST does: a mock
 * that replayed the whole set for every call would never produce the empty
 * page that ends readAllPages' loop.
 *
 * `maxRows` simulates a project whose PostgREST `max-rows` is BELOW the page
 * size — the server silently returns fewer rows than `p_limit` asked for, so
 * the loop must advance by rows RECEIVED (review round 2, #2).
 */
function pagingRpc(rows: Record<string, unknown>[], maxRows = Infinity) {
  const calls: Array<{ name: string; args: RpcArgs }> = []
  mockRpc.mockImplementation((name: string, args: RpcArgs) => {
    calls.push({ name, args })
    const size = Math.min(args.p_limit, maxRows)
    return Promise.resolve({
      data: rows.slice(args.p_offset, args.p_offset + size),
      error: null,
    })
  })
  return { calls, offsets: () => calls.map((c) => c.args.p_offset) }
}

/**
 * A scripted page sequence: call k receives `pages[k]`, and everything past
 * the end is an empty page. `pagingRpc` slices one fixed array, so it can
 * never hand the same id back twice -- this one can, which is exactly what a
 * concurrent `member_tags` INSERT does to an OFFSET walk: every row at or
 * after the new member shifts down one position, so the row that sat on the
 * page boundary is returned AGAIN on the next page (review I-1, #162).
 */
function scriptedPagesRpc(pages: Record<string, unknown>[][]) {
  const calls: Array<{ name: string; args: RpcArgs }> = []
  mockRpc.mockImplementation((name: string, args: RpcArgs) => {
    const page = pages[calls.length] ?? []
    calls.push({ name, args })
    return Promise.resolve({ data: page, error: null })
  })
  return { calls }
}

/**
 * The tag branch still reads `campaign_tags` through `from()`; every other
 * table access is a bug now (#162), so the implementation throws loudly here
 * rather than quietly returning `undefined` and failing on a later `.select`.
 */
function setupCampaignTags(tagRows: { tag_id: string }[]) {
  mockFrom.mockReset()
  const campaignTagsEq = vi.fn().mockResolvedValue({ data: tagRows, error: null })
  mockFrom.mockImplementation((table: string) => {
    if (table === 'campaign_tags') {
      return { select: vi.fn().mockReturnValue({ eq: campaignTagsEq }) }
    }
    throw new Error(`unexpected from('${table}'): recipients must resolve via RPC`)
  })
  return { campaignTagsEq }
}

function tagCampaign() {
  return buildCampaign({ targetAudience: 'tag' })
}

function selectedCampaign() {
  return buildCampaign({ targetAudience: 'selected' })
}

describe('resolveTargetMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockReset()
    mockRpc.mockReset()
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

  // F1 (gstack review) -- the promo/'all' and winback branches used to issue
  // an UNPAGED select. PostgREST truncates one at `max-rows` (1000) with NO
  // error, and #161 is what makes that reachable: before it, every tenant was
  // capped at 1,000 sends/month anyway, so the read cap was invisible. After
  // it a growth tenant enforces 10,000, and the read cap is the only thing
  // left silently deciding who is left out of a "completed" campaign.
  const bulkRows = (n: number) =>
    memberRows(Array.from({ length: n }, (_, i) => `m-${i}`))

  function cutoffsOf(pages: TablePage[]): unknown[] {
    return pages.map(
      (page) =>
        page.filters.find(([op, column]) => op === 'lt' && column === 'last_visit_at')?.[2]
    )
  }

  it('pages a 1,500-member promo audience to completion, in a total order', async () => {
    const campaign = buildCampaign({ type: 'promo', targetAudience: 'all' })
    const read = setupChain({ data: bulkRows(1500), error: null })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toHaveLength(1500)
    expect(new Set(result.map((m) => m.id)).size).toBe(1500)
    expect(read.pages.map((page) => page.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [1500, 2499],
    ])
    for (const page of read.pages) {
      expect(page.ordered).toEqual(['id'])
      expect(page.filters).toContainEqual(['eq', 'restaurant_id', 'r-1'])
      expect(page.filters).toContainEqual(['eq', 'status', 'active'])
    }
  })

  it('pages a 1,500-member winback audience to completion, re-applying the cutoff on EVERY page', async () => {
    // A page walk that dropped `.lt('last_visit_at', cutoff)` after the first
    // request would return the tenant's whole active list from page 2 on --
    // recently-visiting customers included -- and nothing downstream would
    // notice, because the count would still look plausible.
    const campaign = buildCampaign({
      type: 'winback',
      targetAudience: 'all',
      schedule: { inactiveDays: 60 },
    })
    const read = setupChain({ data: bulkRows(1500), error: null })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toHaveLength(1500)
    expect(read.pages).toHaveLength(3)
    for (const page of read.pages) {
      expect(page.ordered).toEqual(['id'])
      expect(page.filters).toContainEqual(['eq', 'restaurant_id', 'r-1'])
      expect(page.filters).toContainEqual(['eq', 'status', 'active'])
    }
    const cutoffs = cutoffsOf(read.pages)
    expect(cutoffs.every((value) => typeof value === 'string')).toBe(true)
    expect(new Set(cutoffs).size).toBe(1)
  })

  it('returns empty array for birthday campaigns', async () => {
    const campaign = buildCampaign({ type: 'birthday', targetAudience: 'all' })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  // B1
  it('resolves the tag branch through active_members_by_tags, never through a member table read', async () => {
    setupCampaignTags([{ tag_id: 't-1' }])
    pagingRpc(memberRows(['m-1']))

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(mockFrom).toHaveBeenCalledWith('campaign_tags')
    expect(mockRpc).toHaveBeenCalledWith('active_members_by_tags', {
      p_restaurant_id: 'r-1',
      p_tag_ids: ['t-1'],
      p_limit: 1000,
      p_offset: 0,
    })
    expect(mockFrom).not.toHaveBeenCalledWith('member_tags')
    expect(mockFrom).not.toHaveBeenCalledWith('members')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'm-1',
      restaurantId: 'r-1',
      phone: '85291234567',
      pointsBalance: 100,
      status: 'active',
    })
  })

  // B2
  it('resolves the selected branch through active_members_by_campaign_selection with no table reads at all', async () => {
    pagingRpc(memberRows(['m-1', 'm-2']))

    const result = await resolveTargetMembers(selectedCampaign(), 'r-1')

    expect(mockRpc).toHaveBeenCalledWith('active_members_by_campaign_selection', {
      p_restaurant_id: 'r-1',
      p_campaign_id: 'camp-1',
      p_limit: 1000,
      p_offset: 0,
    })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result.map((m) => m.id)).toEqual(['m-1', 'm-2'])
  })

  // B3 — the #162 invariant: no member UUID ever leaves the process.
  it('never puts a member id into an outbound request (tag branch)', async () => {
    setupCampaignTags([{ tag_id: 't-1' }])
    pagingRpc(memberRows(['m-1', 'm-2', 'm-3']))

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    const outbound = JSON.stringify(mockRpc.mock.calls)
    for (const member of result) {
      expect(outbound).not.toContain(member.id)
    }
    expect(mockFrom).not.toHaveBeenCalledWith('members')
  })

  it('never puts a member id into an outbound request (selected branch)', async () => {
    pagingRpc(memberRows(['m-1', 'm-2', 'm-3']))

    const result = await resolveTargetMembers(selectedCampaign(), 'r-1')

    const outbound = JSON.stringify(mockRpc.mock.calls)
    for (const member of result) {
      expect(outbound).not.toContain(member.id)
    }
    expect(mockFrom).not.toHaveBeenCalled()
  })

  // B4
  it('pages a 1,200-member tag audience to completion', async () => {
    setupCampaignTags([{ tag_id: 't-1' }])
    const rpc = pagingRpc(memberRows(Array.from({ length: 1200 }, (_, i) => `m-${i}`)))

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(rpc.offsets()).toEqual([0, 1000, 1200])
    expect(result).toHaveLength(1200)
    expect(new Set(result.map((m) => m.id)).size).toBe(1200)
  })

  it('pages a 1,200-member selected audience to completion', async () => {
    const rpc = pagingRpc(memberRows(Array.from({ length: 1200 }, (_, i) => `m-${i}`)))

    const result = await resolveTargetMembers(selectedCampaign(), 'r-1')

    expect(rpc.offsets()).toEqual([0, 1000, 1200])
    expect(result).toHaveLength(1200)
    expect(new Set(result.map((m) => m.id)).size).toBe(1200)
  })

  // B5 — the readAllPages contract survives the move to p_limit/p_offset.
  it('pages 2,500 rows and ends on the empty page', async () => {
    setupCampaignTags([{ tag_id: 't-1' }])
    const rpc = pagingRpc(memberRows(Array.from({ length: 2500 }, (_, i) => `m-${i}`)))

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(rpc.offsets()).toEqual([0, 1000, 2000, 2500])
    expect(result).toHaveLength(2500)
  })

  it('stops on the empty page when the row count is an exact multiple of the page size', async () => {
    setupCampaignTags([{ tag_id: 't-1' }])
    const rpc = pagingRpc(memberRows(Array.from({ length: 1000 }, (_, i) => `m-${i}`)))

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(rpc.offsets()).toEqual([0, 1000])
    expect(result).toHaveLength(1000)
  })

  it('resolves every row when the project max-rows is BELOW the page size', async () => {
    // 1,200 rows on a project capped at 500 rows per call: a loop that stopped
    // on a short page would return 500; one advancing by p_limit would SKIP
    // rows 500-999.
    setupCampaignTags([{ tag_id: 't-1' }])
    const rpc = pagingRpc(
      memberRows(Array.from({ length: 1200 }, (_, i) => `m-${i}`)),
      500
    )

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(rpc.offsets()).toEqual([0, 500, 1000, 1200])
    expect(result).toHaveLength(1200)
    expect(new Set(result.map((m) => m.id)).size).toBe(1200)
  })

  // B6
  it('resolves to [] when the campaign has no linked tags (no RPC call)', async () => {
    setupCampaignTags([])
    pagingRpc([])

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(result).toEqual([])
    expect(mockFrom).toHaveBeenCalledWith('campaign_tags')
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('resolves to [] when the linked tag has 0 members (one RPC call, no member read)', async () => {
    setupCampaignTags([{ tag_id: 't-1' }])
    const rpc = pagingRpc([])

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(result).toEqual([])
    expect(rpc.calls).toHaveLength(1)
    expect(mockFrom).not.toHaveBeenCalledWith('members')
  })

  it('resolves to [] when the campaign has no selected members', async () => {
    const rpc = pagingRpc([])

    const result = await resolveTargetMembers(selectedCampaign(), 'r-1')

    expect(result).toEqual([])
    expect(rpc.calls).toHaveLength(1)
  })

  // B7
  it('surfaces an RPC error from the tag branch as fetchTagMembers: <message>', async () => {
    setupCampaignTags([{ tag_id: 't-1' }])
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } })

    await expect(resolveTargetMembers(tagCampaign(), 'r-1')).rejects.toThrow(
      'fetchTagMembers: db down'
    )
  })

  it('surfaces an RPC error from the selected branch as fetchSelectedMembers: <message>', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } })

    await expect(resolveTargetMembers(selectedCampaign(), 'r-1')).rejects.toThrow(
      'fetchSelectedMembers: db down'
    )
  })

  // B8
  // I-1 (review, #162) -- cross-page dedupe. `DISTINCT ON (m.id)` dedupes
  // WITHIN one page; it cannot see a row an earlier page already returned.
  // The deleted `fetchTaggedMemberIds` closed this with a `new Set` over the
  // whole walk; nothing replaced it, so a merchant tagging members mid-send
  // could get one recipient messaged (and charged) twice.
  it('yields a member once when two consecutive pages overlap (tag branch)', async () => {
    setupCampaignTags([{ tag_id: 't-1' }])
    scriptedPagesRpc([memberRows(['m-1', 'm-2']), memberRows(['m-2', 'm-3'])])

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(result.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3'])
    expect(result.filter((m) => m.id === 'm-2')).toHaveLength(1)
  })

  it('yields a member once when two consecutive pages overlap (selected branch)', async () => {
    scriptedPagesRpc([memberRows(['m-1', 'm-2']), memberRows(['m-2', 'm-3'])])

    const result = await resolveTargetMembers(selectedCampaign(), 'r-1')

    expect(result.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3'])
    expect(result.filter((m) => m.id === 'm-2')).toHaveLength(1)
  })

  it('includes a member tagged AFTER campaign creation (dynamic membership)', async () => {
    // The tag link existed at create time; m-2 was tagged later. The RPC joins
    // member_tags live at SEND time, so m-2 is resolved.
    setupCampaignTags([{ tag_id: 't-1' }])
    pagingRpc(memberRows(['m-2']))

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('m-2')
  })

  // Review (Grok, Important): the three tests below used to carry the names
  // of #162's isolation / dedupe / status acceptance criteria, but a mocked
  // `supabase.rpc` cannot see migration 079's SQL -- a poisoned member_tags
  // row, `DISTINCT ON (m.id)` and `m.status = 'active'` are properties of
  // the database, and mocking them proves nothing about them. They are
  // asserted against real Postgres in
  // src/infrastructure/supabase/__tests__/recipient-rpcs.db.test.ts. What a
  // mock CAN prove is the request this caller makes and the mapping it does,
  // so that is all these three claim now.
  it('calls each RPC with exactly the tenant-scoped arguments it was given', async () => {
    setupCampaignTags([{ tag_id: 't-1' }, { tag_id: 't-2' }])
    const tagRpc = pagingRpc([])
    await resolveTargetMembers(tagCampaign(), 'r-1')
    expect(tagRpc.calls[0].name).toBe('active_members_by_tags')
    expect(tagRpc.calls[0].args).toEqual({
      p_restaurant_id: 'r-1',
      p_tag_ids: ['t-1', 't-2'],
      p_limit: 1000,
      p_offset: 0,
    })

    mockRpc.mockReset()
    const selectedRpc = pagingRpc([])
    await resolveTargetMembers(selectedCampaign(), 'r-1')
    expect(selectedRpc.calls[0].name).toBe('active_members_by_campaign_selection')
    expect(selectedRpc.calls[0].args).toEqual({
      p_restaurant_id: 'r-1',
      p_campaign_id: 'camp-1',
      p_limit: 1000,
      p_offset: 0,
    })
  })

  it('sends EVERY linked tag id in one RPC call, never one call per tag', async () => {
    // Server-side dedupe only helps if the whole tag set goes out in a single
    // query; one call per tag would return a member once per tag it carries.
    // (That the RPC itself dedupes is the DB test's job.)
    setupCampaignTags([{ tag_id: 't-1' }, { tag_id: 't-2' }])
    const rpc = pagingRpc(memberRows(['m-1']))

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    for (const call of rpc.calls) {
      expect(call.args.p_tag_ids).toEqual(['t-1', 't-2'])
    }
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('m-1')
  })

  it('maps the RPC result through unchanged (the caller filters nothing)', async () => {
    // `m.status = 'active'` lives in the RPC (079) and is proven in the DB
    // test. The complementary property here -- the one a mock CAN see -- is
    // that this branch adds no filter of its own: whatever the RPC returns is
    // what the worker gets, mapped column for column.
    setupCampaignTags([{ tag_id: 't-1' }])
    pagingRpc([
      { ...memberRow, id: 'm-1' },
      {
        ...memberRow,
        id: 'm-9',
        status: 'unsubscribed',
        preferred_language: 'zh-HK',
        points_balance: 42,
      },
    ])

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(result.map((m) => m.id)).toEqual(['m-1', 'm-9'])
    expect(result.map((m) => m.status)).toEqual(['active', 'unsubscribed'])
    expect(result[1].preferredLanguage).toBe('zh-HK')
    expect(result[1].pointsBalance).toBe(42)
  })
})
