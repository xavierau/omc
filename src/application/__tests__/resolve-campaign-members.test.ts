import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'
import {
  CONTACT_QUALITY_THRESHOLDS,
  CONTACT_QUALITY_WINDOW_DAYS,
} from '@/domain/value-objects/contact-quality'

const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}))

import { resolveTargetMembers } from '@/application/resolve-campaign-members'

// CAMP-016: every audience resolves through campaign_audience_members
// (migration 086) with the campaign's snapshotted filters. The SQL itself
// (tenant scoping, lapsed, quality) is asserted against a real Postgres in
// campaign-audience-rpcs.db.test.ts; these tests prove what the CALLER sends
// and how it walks the pages.

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
    lastEnqueuedAt: null,
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

const memberRows = (ids: string[]) => ids.map((id) => ({ ...memberRow, id }))
// Zero-padded so string order is id order, as uuid order is in Postgres.
const range = (n: number) => Array.from({ length: n }, (_, i) => `m-${String(i).padStart(5, '0')}`)

interface RpcArgs extends Record<string, unknown> {
  p_limit: number
  p_after_id: string | null
}

type Row = Record<string, unknown> & { id: string }

/**
 * Keyset pages like migration 086: rows with id > p_after_id, ORDER BY id,
 * LIMIT p_limit; maxRows simulates a lower PostgREST cap. `rows` may be a
 * function, re-evaluated per call, to model the set changing mid-walk.
 */
function pagingRpc(rows: Row[] | (() => Row[]), maxRows = Infinity) {
  const calls: Array<{ name: string; args: RpcArgs }> = []
  mockRpc.mockImplementation((name: string, args: RpcArgs) => {
    calls.push({ name, args })
    const current = (typeof rows === 'function' ? rows() : rows).filter(
      (r) => args.p_after_id === null || r.id > args.p_after_id
    )
    const size = Math.min(args.p_limit, maxRows)
    return Promise.resolve({ data: current.slice(0, size), error: null })
  })
  return { calls, afterIds: () => calls.map((c) => c.args.p_after_id) }
}

/** Call k receives pages[k]; models a row shifting across a page boundary mid-walk. */
function scriptedPagesRpc(pages: Record<string, unknown>[][]) {
  let n = 0
  mockRpc.mockImplementation(() => Promise.resolve({ data: pages[n++] ?? [], error: null }))
}

/** campaign_tags is the only table read allowed; recipients come from the RPC. */
function setupCampaignTags(tagRows: { tag_id: string }[]) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'campaign_tags') {
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: tagRows, error: null }) }) }
    }
    throw new Error(`unexpected from('${table}'): recipients must resolve via RPC`)
  })
}

const filterArgs = (args: RpcArgs) =>
  Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'p_limit' && k !== 'p_after_id'))

describe('resolveTargetMembers (CAMP-016 single resolver)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockReset()
    mockRpc.mockReset()
    setupCampaignTags([])
  })

  it('a promo to all members calls campaign_audience_members with the snapshot and the contact-quality thresholds', async () => {
    const rpc = pagingRpc([memberRow])
    const campaign = buildCampaign({ audienceSkipQuality: 'red', audienceLapsedDays: 45 })

    const result = await resolveTargetMembers(campaign, 'r-1')

    expect(result.map((m) => m.id)).toEqual(['m-1'])
    expect(rpc.calls[0].name).toBe('campaign_audience_members')
    expect(filterArgs(rpc.calls[0].args)).toEqual({
      p_restaurant_id: 'r-1',
      p_audience: 'all',
      p_tag_ids: null,
      p_member_ids: null,
      p_campaign_id: null,
      p_lapsed_days: 45,
      p_never_visited_lapsed: true,
      p_skip: 'red',
      p_window_days: CONTACT_QUALITY_WINDOW_DAYS,
      p_green: CONTACT_QUALITY_THRESHOLDS.green,
      p_yellow: CONTACT_QUALITY_THRESHOLDS.yellow,
    })
  })

  it('tags compose with the lapsed filter (no tag-over-win-back precedence)', async () => {
    setupCampaignTags([{ tag_id: 't-1' }, { tag_id: 't-2' }])
    const rpc = pagingRpc([memberRow])
    const campaign = buildCampaign({
      type: 'winback', targetAudience: 'tag', audienceLapsedDays: 30, audienceSkipQuality: 'red_yellow',
    })

    await resolveTargetMembers(campaign, 'r-1')

    expect(filterArgs(rpc.calls[0].args)).toMatchObject({
      p_audience: 'tag', p_tag_ids: ['t-1', 't-2'], p_lapsed_days: 30, p_skip: 'red_yellow',
    })
    expect(mockRpc).toHaveBeenCalledTimes(2) // one page + the empty page; one call for every tag
  })

  it('selected resolves through the campaign id, never a member id list', async () => {
    const rpc = pagingRpc([memberRow])
    await resolveTargetMembers(buildCampaign({ targetAudience: 'selected' }), 'r-1')
    expect(filterArgs(rpc.calls[0].args)).toMatchObject({
      p_audience: 'selected', p_campaign_id: 'camp-1', p_member_ids: null,
    })
  })

  describe('campaigns created before 086 keep their behaviour', () => {
    it('no snapshot = no lapsed filter and skip off for a promo', async () => {
      const rpc = pagingRpc([memberRow])
      await resolveTargetMembers(buildCampaign(), 'r-1')
      expect(filterArgs(rpc.calls[0].args)).toMatchObject({ p_lapsed_days: null, p_skip: 'off' })
    })

    it('a win-back to all uses schedule.inactiveDays and excludes never-visited members', async () => {
      const rpc = pagingRpc([memberRow])
      await resolveTargetMembers(buildCampaign({ type: 'winback', schedule: { inactiveDays: 60 } }), 'r-1')
      expect(filterArgs(rpc.calls[0].args)).toMatchObject({
        p_lapsed_days: 60, p_never_visited_lapsed: false, p_skip: 'off',
      })
    })

    it('a win-back to all without inactiveDays defaults to 30', async () => {
      const rpc = pagingRpc([memberRow])
      await resolveTargetMembers(buildCampaign({ type: 'winback' }), 'r-1')
      expect(filterArgs(rpc.calls[0].args)).toMatchObject({ p_lapsed_days: 30, p_never_visited_lapsed: false })
    })

    it('a win-back to a tag keeps the old tag-only read (no lapsed filter)', async () => {
      setupCampaignTags([{ tag_id: 't-1' }])
      const rpc = pagingRpc([memberRow])
      await resolveTargetMembers(buildCampaign({ type: 'winback', targetAudience: 'tag' }), 'r-1')
      expect(filterArgs(rpc.calls[0].args)).toMatchObject({ p_lapsed_days: null, p_never_visited_lapsed: true })
    })
  })

  it('returns [] for birthday campaigns without a query', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await resolveTargetMembers(buildCampaign({ type: 'birthday' }), 'r-1')).toEqual([])
    expect(mockRpc).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns [] for a tag campaign with no linked tags (no RPC call)', async () => {
    expect(await resolveTargetMembers(buildCampaign({ targetAudience: 'tag' }), 'r-1')).toEqual([])
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('pages 2,500 rows and ends on the empty page', async () => {
    const rpc = pagingRpc(memberRows(range(2500)))
    const result = await resolveTargetMembers(buildCampaign(), 'r-1')
    expect(rpc.afterIds()).toEqual([null, 'm-00999', 'm-01999', 'm-02499'])
    expect(result).toHaveLength(2500)
  })

  it('resolves every row when the project max-rows is BELOW the page size', async () => {
    const rpc = pagingRpc(memberRows(range(1200)), 500)
    const result = await resolveTargetMembers(buildCampaign(), 'r-1')
    expect(rpc.afterIds()).toEqual([null, 'm-00499', 'm-00999', 'm-01199'])
    expect(new Set(result.map((m) => m.id)).size).toBe(1200)
  })

  // r3 F3: an OFFSET walk loses the boundary row when a page-1 member drops
  // out (turns red, visits) between page fetches; the keyset walk does not.
  it('a page-1 member dropping out between pages loses nobody else', async () => {
    let live = memberRows(range(1500))
    const rpc = pagingRpc(() => live)
    mockRpc.mockImplementationOnce((name: string, args: RpcArgs) => {
      rpc.calls.push({ name, args })
      const page = live.slice(0, args.p_limit)
      live = live.filter((r) => r.id !== 'm-00000') // flips after page 1 is read
      return Promise.resolve({ data: page, error: null })
    })
    const result = await resolveTargetMembers(buildCampaign(), 'r-1')
    const ids = new Set(result.map((m) => m.id))
    expect(live.filter((r) => !ids.has(r.id))).toEqual([])
    expect(ids.size).toBe(1500)
  })

  it('every page carries the same filters', async () => {
    const rpc = pagingRpc(memberRows(range(1500)))
    await resolveTargetMembers(buildCampaign({ audienceSkipQuality: 'red', audienceLapsedDays: 30 }), 'r-1')
    expect(rpc.calls).toHaveLength(3)
    const [first, ...rest] = rpc.calls.map((c) => filterArgs(c.args))
    for (const page of rest) expect(page).toEqual(first)
  })

  it('yields a member once when two consecutive pages overlap', async () => {
    const page1 = memberRows(range(1000))
    scriptedPagesRpc([page1, memberRows(['m-00999', 'm-01000'])])
    const result = await resolveTargetMembers(buildCampaign(), 'r-1')
    expect(result).toHaveLength(1001)
  })

  it('surfaces an RPC error as resolveTargetMembers: <message>', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(resolveTargetMembers(buildCampaign(), 'r-1')).rejects.toThrow('resolveTargetMembers: boom')
  })

  it('maps the WAQ-007 cooldown columns onto the Member shape', async () => {
    pagingRpc([{ ...memberRow, pmm_throttled_until: '2026-01-01T00:00:00Z', unreachable_at: '2026-01-02T00:00:00Z', preferred_language: 'en' }])
    const [m] = await resolveTargetMembers(buildCampaign(), 'r-1')
    expect(m).toMatchObject({ pmmThrottledUntil: '2026-01-01T00:00:00Z', unreachableAt: '2026-01-02T00:00:00Z', preferredLanguage: 'en' })
  })
})
