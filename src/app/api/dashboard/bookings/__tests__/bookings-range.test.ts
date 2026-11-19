/**
 * BOOK-004 AC-1: GET /api/dashboard/bookings?from&to. Runs the real route and
 * the real repository against an in-memory table that evaluates the PostgREST
 * filters the repository sends (eq/neq/gte/lte/in, order, limit, head count),
 * so tenant scoping, the date window, ordering and the cap are all exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const table: { rows: Row[]; queries: string[][] } = { rows: [], queries: [] }

function query() {
  const filters: Array<(r: Row) => boolean> = []
  const orders: Array<[string, boolean]> = []
  const log: string[] = []
  table.queries.push(log)
  let limit = Infinity
  let head = false
  const chain = {
    select(_cols: string, opts?: { head?: boolean }) { head = opts?.head === true; return chain },
    eq(c: string, v: unknown) { log.push(`eq:${c}=${v}`); filters.push((r) => r[c] === v); return chain },
    neq(c: string, v: unknown) { log.push(`neq:${c}=${v}`); filters.push((r) => r[c] !== v); return chain },
    in(c: string, v: unknown[]) { log.push(`in:${c}=${v}`); filters.push((r) => v.includes(r[c])); return chain },
    gte(c: string, v: string) { log.push(`gte:${c}=${v}`); filters.push((r) => String(r[c]) >= v); return chain },
    lte(c: string, v: string) { log.push(`lte:${c}=${v}`); filters.push((r) => String(r[c]) <= v); return chain },
    order(c: string, o?: { ascending?: boolean }) { orders.push([c, o?.ascending !== false]); return chain },
    limit(n: number) { log.push(`limit:${n}`); limit = n; return chain },
    then(resolve: (v: unknown) => unknown) {
      const hits = table.rows.filter((r) => filters.every((f) => f(r)))
      hits.sort((a, b) => {
        for (const [c, asc] of orders) {
          const d = String(a[c]).localeCompare(String(b[c]))
          if (d !== 0) return asc ? d : -d
        }
        return 0
      })
      return Promise.resolve(head ? { count: hits.length, error: null } : { data: hits.slice(0, limit), error: null }).then(resolve)
    },
  }
  return chain
}

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: () => ({ from: () => query() }) }))
vi.mock('@/infrastructure/supabase/guards/tenant-guard')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { BOOKINGS_RANGE_CAP } from '@/domain/entities/booking-request'
import { fetchBookings } from '@/hooks/use-bookings'
import { fetchRange, SHOW_PENDING } from '@/components/dashboard/bookings/bookings-view-state'
import { GET } from '../route'

const A = 'rest-a'
const B = 'rest-b'
let seq = 0

function add(restaurantId: string, booking_date: string, booking_time: string, status = 'pending') {
  const id = `b${++seq}`
  table.rows.push({
    id, restaurant_id: restaurantId, member_id: null, phone: '+85291234567', name: `Diner ${id}`, party_size: 2,
    booking_date, booking_time: `${booking_time}:00`, notes: null, status, decline_reason: null, decided_by: null,
    decided_at: status === 'pending' ? null : '2026-11-01T00:00:00Z', source: 'chat', campaign_id: null,
    created_at: new Date(Date.UTC(2026, 10, 1) + seq * 1000).toISOString(), decision_message_status: null,
  })
  return id
}

const get = (qs = '') => GET(new Request(`http://localhost/api/dashboard/bookings${qs}`))
const ids = async (res: Response) => ((await res.json()).bookings as Array<{ id: string }>).map((b) => b.id)

beforeEach(() => {
  table.rows = []
  table.queries = []
  seq = 0
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u', restaurantId: A, role: 'staff', tenantStatus: 'active' })
})

describe('GET /api/dashboard/bookings with a date range (BOOK-004)', () => {
  it('returns in-range rows ordered by date then time, inclusive at both ends', async () => {
    const late = add(A, '2026-11-21', '19:30', 'confirmed')
    const early = add(A, '2026-11-21', '12:30')
    const first = add(A, '2026-11-01', '20:00', 'declined')
    const last = add(A, '2026-11-30', '09:00')
    add(A, '2026-10-31', '12:00')
    add(A, '2026-12-01', '12:00')
    const res = await get('?from=2026-11-01&to=2026-11-30')
    expect(res.status).toBe(200)
    expect(await ids(res)).toEqual([first, early, late, last])
  })

  it('R2: never returns unverified agent bookings', async () => {
    const shown = add(A, '2026-11-21', '12:30')
    add(A, '2026-11-21', '13:00', 'unverified')
    expect(await ids(await get('?from=2026-11-01&to=2026-11-30'))).toEqual([shown])
  })

  it("R1: scopes by the session tenant inside the query; another tenant's rows never appear", async () => {
    const mine = add(A, '2026-11-21', '12:30')
    add(B, '2026-11-21', '12:00')
    const res = await get('?from=2026-11-01&to=2026-11-30')
    const body = await res.json()
    expect(body.bookings.map((b: { id: string }) => b.id)).toEqual([mine])
    expect(body.bookings.every((b: { restaurantId: string }) => b.restaurantId === A)).toBe(true)
    for (const q of table.queries) expect(q).toContain(`eq:restaurant_id=${A}`)
  })

  it('R4: caps the rows and says truncated when there were more', async () => {
    for (let i = 0; i < BOOKINGS_RANGE_CAP + 2; i++) add(A, '2026-11-21', '12:30')
    const body = await (await get('?from=2026-11-01&to=2026-11-30')).json()
    expect(body.bookings).toHaveLength(BOOKINGS_RANGE_CAP)
    expect(body.truncated).toBe(true)
  })

  it('not truncated when everything fits', async () => {
    add(A, '2026-11-21', '12:30')
    expect((await (await get('?from=2026-11-01&to=2026-11-30')).json()).truncated).toBe(false)
  })

  it('pendingCount counts every pending booking of the tenant, any date, with or without a range', async () => {
    add(A, '2026-11-21', '12:30')
    add(A, '2025-01-01', '12:30')
    add(A, '2026-11-21', '13:00', 'confirmed')
    add(A, '2026-11-21', '13:30', 'unverified')
    add(B, '2026-11-21', '12:00')
    expect((await (await get('?from=2026-11-01&to=2026-11-30')).json()).pendingCount).toBe(2)
    expect((await (await get()).json()).pendingCount).toBe(2)
  })

  it('without params keeps the old list: pending + decided, newest first, no truncated flag', async () => {
    const older = add(A, '2026-12-25', '12:30')
    const newer = add(A, '2025-01-01', '12:30', 'confirmed')
    add(A, '2026-11-21', '13:30', 'unverified')
    const body = await (await get()).json()
    expect(body.bookings.map((b: { id: string }) => b.id)).toEqual([newer, older])
    expect(body).not.toHaveProperty('truncated')
  })

  it.each([
    ['?from=2026-11-01', 'only from'],
    ['?to=2026-11-30', 'only to'],
    ['?from=2026-11-31&to=2026-12-01', 'impossible date'],
    ['?from=20261101&to=2026-11-30', 'wrong format'],
    ['?from=2026-11-01&to=2026-11-30T00:00', 'trailing time'],
    ["?from=2026-11-01'or'1&to=2026-11-30", 'injection attempt'],
    ['?from=2026-12-01&to=2026-11-30', 'from after to'],
    ['?from=2025-01-01&to=2026-02-06', 'span over 400 days'],
  ])('400 on a bad range (%s: %s) and no query runs', async (qs) => {
    const res = await get(qs)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_range' })
    expect(table.queries).toHaveLength(0)
  })

  it('a 400-day span is allowed', async () => {
    expect((await get('?from=2025-01-01&to=2026-02-05')).status).toBe(200)
  })
})

describe('GET /api/dashboard/bookings?status=pending: every pending booking, any date (BOOK-004 r2)', () => {
  it('lists every pending booking of the tenant, past-dated included, soonest first; length equals pendingCount', async () => {
    const future = add(A, '2026-12-24', '19:00')
    const past = add(A, '2025-03-01', '12:00')
    const soon = add(A, '2026-11-20', '12:30')
    add(A, '2026-11-20', '13:00', 'confirmed')
    add(A, '2025-03-01', '13:00', 'declined')
    add(A, '2026-11-20', '13:30', 'unverified')
    add(B, '2025-03-01', '11:00')
    const body = await (await get('?status=pending')).json()
    expect(body.bookings.map((b: { id: string }) => b.id)).toEqual([past, soon, future])
    expect(body.bookings).toHaveLength(body.pendingCount)
    expect(body.truncated).toBe(false)
    for (const q of table.queries) expect(q).toContain(`eq:restaurant_id=${A}`)
  })

  it('R4: caps the pending list and says truncated', async () => {
    for (let i = 0; i < BOOKINGS_RANGE_CAP + 1; i++) add(A, '2026-11-21', '12:30')
    const body = await (await get('?status=pending')).json()
    expect(body.bookings).toHaveLength(BOOKINGS_RANGE_CAP)
    expect(body.truncated).toBe(true)
  })

  it.each([
    ['?status=confirmed', 'another status'],
    ['?status=unverified', 'unverified'],
    ['?status=', 'empty'],
    ['?status=pending&from=2026-11-01&to=2026-11-30', 'combined with a range'],
  ])('400 on %s (%s) and no query runs', async (qs) => {
    const res = await get(qs)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_status' })
    expect(table.queries).toHaveLength(0)
  })

  it("the needs-reply pill's Show fetches a list whose length equals the pill count, with the past-dated booking", async () => {
    const past = add(A, '2025-06-01', '12:00')
    add(A, '2026-11-25', '19:00')
    add(A, '2026-11-25', '20:00', 'confirmed')
    vi.stubGlobal('fetch', (url: string) => get(url.replace('/api/dashboard/bookings', '')))
    try {
      const query = fetchRange(SHOW_PENDING.view, '2026-11-19', SHOW_PENDING.tableRange, '2026-11-19')
      const payload = await fetchBookings(query)
      expect(payload.pendingCount).toBe(2)
      expect(payload.bookings).toHaveLength(payload.pendingCount)
      expect(payload.bookings.map((b) => b.id)).toContain(past)
      expect(payload.bookings.every((b) => b.status === 'pending')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
