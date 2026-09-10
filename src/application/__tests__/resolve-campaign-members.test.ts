import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'

const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockLt = vi.fn()
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

function setupChain(result: { data: unknown[]; error: null }) {
  const thenable = {
    eq: mockEq,
    lt: mockLt,
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  mockFrom.mockReturnValue({ select: mockSelect })
  mockSelect.mockReturnValue(thenable)
  mockEq.mockReturnValue(thenable)
  mockLt.mockReturnValue(thenable)
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
  it('includes a member tagged AFTER campaign creation (dynamic membership)', async () => {
    // The tag link existed at create time; m-2 was tagged later. The RPC joins
    // member_tags live at SEND time, so m-2 is resolved.
    setupCampaignTags([{ tag_id: 't-1' }])
    pagingRpc(memberRows(['m-2']))

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('m-2')
  })

  it('passes the caller tenant as p_restaurant_id on both branches (cross-tenant scoping)', async () => {
    // The SQL-side proof (a poisoned member_tags.restaurant_id yields no row)
    // lives in migration 079 + the scratch-DB run; here we prove the caller
    // never widens the scope it asks for.
    setupCampaignTags([{ tag_id: 't-1' }])
    const tagRpc = pagingRpc([])
    await resolveTargetMembers(tagCampaign(), 'r-1')
    expect(tagRpc.calls[0].args.p_restaurant_id).toBe('r-1')

    mockRpc.mockReset()
    const selectedRpc = pagingRpc([])
    await resolveTargetMembers(selectedCampaign(), 'r-1')
    expect(selectedRpc.calls[0].args.p_restaurant_id).toBe('r-1')
  })

  it('sends both linked tag ids in one RPC call and yields one recipient per member', async () => {
    // A member carrying two selected tags must receive exactly ONE message.
    // DISTINCT ON (m.id) does that server-side (asserted structurally in the
    // 079 contract test and on the scratch DB); here the branch must not
    // re-introduce a duplicate by calling once per tag.
    setupCampaignTags([{ tag_id: 't-1' }, { tag_id: 't-2' }])
    const rpc = pagingRpc(memberRows(['m-1']))

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(rpc.calls[0].args.p_tag_ids).toEqual(['t-1', 't-2'])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('m-1')
  })

  it('returns no unsubscribed member on the tag branch (status filtered server-side)', async () => {
    // The RPC applies m.status = 'active' (079); an unsubscribed member
    // carrying the tag never reaches the worker at all.
    setupCampaignTags([{ tag_id: 't-1' }])
    pagingRpc([])

    const result = await resolveTargetMembers(tagCampaign(), 'r-1')

    expect(result).toEqual([])
  })
})
