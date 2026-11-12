import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { getMemberDetailForRestaurant } from '../member-detail-repository'

const MEMBER_ID = 'member-uuid'
const REST_ID = 'rest-uuid'

function buildMemberRow(): Record<string, unknown> {
  return {
    id: MEMBER_ID,
    phone: '+85212345678',
    name: 'Alice',
    points_balance: 42,
    status: 'active',
    joined_at: '2026-01-01T00:00:00Z',
    last_visit_at: '2026-08-01T00:00:00Z',
    preferred_language: 'en',
    restaurant_id: REST_ID,
  }
}

// Per-table chain: records every .eq() pair, stays chainable through
// select/eq/order/limit, and resolves via .single() (members) or as a
// thenable (receipts terminate on .limit(), coupons on .order()) —
// mirrors campaign-repository.test.ts's selectSpyClient plus the thenable
// idiom from member-repository.test.ts.
function makeChain(result: { data: unknown; error: unknown }) {
  const filters: Array<[string, unknown]> = []
  const selects: unknown[] = []
  const chain = {
    select: (cols?: unknown) => {
      selects.push(cols)
      return chain
    },
    eq: (col: string, val: unknown) => {
      filters.push([col, val])
      return chain
    },
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve(result),
    then: (
      onFulfilled: (v: typeof result) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return { chain, filters, selects }
}

function buildSpyClient(
  memberResult: { data: unknown; error: unknown },
  receiptsResult: { data: unknown; error: unknown } = { data: [], error: null },
  couponsResult: { data: unknown; error: unknown } = { data: [], error: null },
  tagsResult: { data: unknown; error: unknown } = { data: [], error: null }
) {
  const member = makeChain(memberResult)
  const receipts = makeChain(receiptsResult)
  const coupons = makeChain(couponsResult)
  // TAG-001: the detail view also joins member_tags → tags (read-only).
  const memberTags = makeChain(tagsResult)
  const from = vi.fn((table: string) => {
    if (table === 'members') return member.chain
    if (table === 'receipts') return receipts.chain
    if (table === 'coupons') return coupons.chain
    if (table === 'member_tags') return memberTags.chain
    throw new Error(`unexpected table: ${table}`)
  })
  return { from, memberFilters: member.filters, memberSelects: member.selects, receiptsFilters: receipts.filters, couponsFilters: coupons.filters, memberTagsFilters: memberTags.filters }
}

describe('getMemberDetailForRestaurant', () => {
  beforeEach(() => vi.clearAllMocks())

  it('scopes the members query by id AND restaurant_id', async () => {
    const spy = buildSpyClient({ data: buildMemberRow(), error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await getMemberDetailForRestaurant(MEMBER_ID, REST_ID)

    expect(spy.from).toHaveBeenCalledWith('members')
    expect(spy.memberFilters).toEqual([
      ['id', MEMBER_ID],
      ['restaurant_id', REST_ID],
    ])
  })

  it('scopes the receipts query by member_id AND restaurant_id', async () => {
    const spy = buildSpyClient({ data: buildMemberRow(), error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await getMemberDetailForRestaurant(MEMBER_ID, REST_ID)

    expect(spy.receiptsFilters).toEqual([
      ['member_id', MEMBER_ID],
      ['restaurant_id', REST_ID],
    ])
  })

  it('scopes the coupons query by member_id AND restaurant_id', async () => {
    const spy = buildSpyClient({ data: buildMemberRow(), error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await getMemberDetailForRestaurant(MEMBER_ID, REST_ID)

    expect(spy.couponsFilters).toEqual([
      ['member_id', MEMBER_ID],
      ['restaurant_id', REST_ID],
    ])
  })

  it('scopes the member_tags query by member_id AND restaurant_id', async () => {
    const spy = buildSpyClient({ data: buildMemberRow(), error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await getMemberDetailForRestaurant(MEMBER_ID, REST_ID)

    expect(spy.memberTagsFilters).toEqual([
      ['member_id', MEMBER_ID],
      ['restaurant_id', REST_ID],
    ])
  })

  it('returns null when the member belongs to another restaurant', async () => {
    // PostgREST's real no-match answer for .single(): an error, not a row —
    // same shape whether the id truly doesn't exist or just isn't this
    // tenant's, which is the point of the scoped query.
    const spy = buildSpyClient({ data: null, error: { code: 'PGRST116', message: 'no rows' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    expect(await getMemberDetailForRestaurant(MEMBER_ID, REST_ID)).toBeNull()
  })

  it('returns null for a nonexistent id', async () => {
    // Identical stub shape to the cross-tenant case above — a nonexistent id
    // and a foreign id must be indistinguishable. That indistinguishability
    // IS the fix (#111): no existence oracle.
    const spy = buildSpyClient({ data: null, error: { code: 'PGRST116', message: 'no rows' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    expect(await getMemberDetailForRestaurant('nonexistent-id', REST_ID)).toBeNull()
  })

  it('returns null (does not throw) when the id is a malformed UUID', async () => {
    const spy = buildSpyClient({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await expect(getMemberDetailForRestaurant('not-a-uuid', REST_ID)).resolves.toBeNull()
  })

  it('happy path returns the member plus receipts, coupons and visitCount', async () => {
    const receiptRows = [
      { id: 'r-1', total_amount: 100, points_awarded: 10, created_at: '2026-08-01T00:00:00Z', status: 'approved' },
      { id: 'r-2', total_amount: 200, points_awarded: 20, created_at: '2026-07-01T00:00:00Z', status: 'approved' },
    ]
    const couponRows = [
      { id: 'c-1', code: 'ABC123', type: 'discount', status: 'active', redeemed_at: null },
    ]
    const spy = buildSpyClient(
      { data: buildMemberRow(), error: null },
      { data: receiptRows, error: null },
      { data: couponRows, error: null }
    )
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    const result = await getMemberDetailForRestaurant(MEMBER_ID, REST_ID)

    expect(result).toMatchObject({
      id: MEMBER_ID,
      phone: '+85212345678',
      name: 'Alice',
      points_balance: 42,
      restaurant_id: REST_ID,
    })
    expect(result?.receipts).toHaveLength(2)
    expect(result?.coupons).toHaveLength(1)
    expect(result?.visitCount).toBe(2)
  })

  it('leaks nothing when the member lookup misses but sub-queries return rows', async () => {
    const receiptRows = [
      { id: 'r-1', total_amount: 100, points_awarded: 10, created_at: '2026-08-01T00:00:00Z', status: 'approved' },
    ]
    const couponRows = [
      { id: 'c-1', code: 'ABC123', type: 'discount', status: 'active', redeemed_at: null },
    ]
    const spy = buildSpyClient(
      { data: null, error: { code: 'PGRST116', message: 'no rows' } },
      { data: receiptRows, error: null },
      { data: couponRows, error: null }
    )
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    expect(await getMemberDetailForRestaurant(MEMBER_ID, REST_ID)).toBeNull()
  })

  it('selects an explicit member column allowlist — never select(*), no loyalty_token', async () => {
    const spy = buildSpyClient({ data: buildMemberRow(), error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await getMemberDetailForRestaurant(MEMBER_ID, REST_ID)

    expect(spy.memberSelects).toEqual([
      'id, phone, name, points_balance, status, joined_at, last_visit_at, preferred_language, restaurant_id',
    ])
  })

  it('throws (does not report a miss) on a transient DB error such as a connection failure', async () => {
    const spy = buildSpyClient({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await expect(getMemberDetailForRestaurant(MEMBER_ID, REST_ID)).rejects.toThrow(
      'connection failure'
    )
  })

  it('throws when the receipts sub-query errors instead of rendering an empty history', async () => {
    const spy = buildSpyClient(
      { data: buildMemberRow(), error: null },
      { data: null, error: { message: 'receipts query failed' } }
    )
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await expect(getMemberDetailForRestaurant(MEMBER_ID, REST_ID)).rejects.toThrow(
      'receipts query failed'
    )
  })

  it('throws when the coupons sub-query errors', async () => {
    const spy = buildSpyClient(
      { data: buildMemberRow(), error: null },
      { data: [], error: null },
      { data: null, error: { message: 'coupons query failed' } }
    )
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await expect(getMemberDetailForRestaurant(MEMBER_ID, REST_ID)).rejects.toThrow(
      'coupons query failed'
    )
  })

  // Review round 2, finding 9: the tags branch alone swallowed its error, so a
  // failed join rendered "this member has no tags" — indistinguishable from
  // the truth, and one click away from an admin re-adding tags that exist.
  it('throws when the tags sub-query errors instead of rendering an untagged member', async () => {
    const spy = buildSpyClient(
      { data: buildMemberRow(), error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: { message: 'tags query failed' } }
    )
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await expect(getMemberDetailForRestaurant(MEMBER_ID, REST_ID)).rejects.toThrow(
      'tags query failed'
    )
  })
})
