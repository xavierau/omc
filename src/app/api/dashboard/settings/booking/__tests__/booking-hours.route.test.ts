// BOOK-009 AC-1/AC-2/AC-4 (threat R1): bookingHours saves through the admin
// booking settings PUT and its rev compare-and-swap; GET returns it with the
// generated summary. The real repository runs; only Supabase is recorded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { recordingSupabase, filtersOf, type RecordedQuery } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/application/booking/booking-template-deps', () => ({
  bookingTemplateOverviewFor: vi.fn(async () => ({ templates: null, slots: [] })),
  bookingTemplateStatusesFor: vi.fn(async () => null),
  provisionBookingTemplatesFor: vi.fn(async () => null),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type { BookingHours } from '@/domain/value-objects/booking-hours'
import { GET, PUT } from '../route'

const RID = 'rest-1'
const OPEN = [{ label: '午市', first: '12:00', last: '14:00' }, { label: '晚市', first: '18:00', last: '21:30' }]
const HOURS: BookingHours = {
  scheduleEnabled: true,
  weekly: { mon: [], tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN, sun: OPEN },
  intervalMinutes: 30,
  noticeHours: 2,
  aheadDays: 30,
  special: [{ date: '2026-12-25', periods: [] }],
  tableMinutes: null,
  terms: { zh_hk: '', en: '' },
  info: { address: '', phone: '', mapUrl: '' },
}
const STORED = { mode: 'simple', maxPartySize: 8, rev: 3, bookingRules: 'set menu for 10+', aiRoutingEnabled: true }

function req(body: unknown) {
  return new NextRequest('http://localhost/api/dashboard/settings/booking', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const read = (config: unknown) => ({ data: { booking_config: config } })
const updates = (queries: RecordedQuery[]) => queries.filter((q) => q.calls.some(([m]) => m === 'update'))
const written = (q: RecordedQuery) =>
  (q.calls.find(([m]) => m === 'update')?.[1] as { booking_config: Record<string, unknown> }).booking_config

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

function as(role: string) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: RID, role, tenantStatus: 'active' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T02:00:00Z')) // 10:00 HK, Friday
  as('admin')
})
afterEach(() => vi.useRealTimers())

describe('PUT booking settings with bookingHours', () => {
  it('AC-1: saves the hours with the rev guard on the session tenant, keeping fields the form does not own', async () => {
    const rec = use([read(STORED), read(STORED), { data: [{ id: RID }] }])
    const res = await PUT(req({ mode: 'simple', maxPartySize: 8, bookingHours: HOURS }))
    expect(res.status).toBe(200)
    expect((await res.json()).config.bookingHours).toEqual(HOURS)
    const [update] = updates(rec.queries)
    expect(filtersOf(update)).toEqual([`eq:id=${RID}`, 'eq:booking_config->>rev=3'])
    expect(written(update)).toMatchObject({ bookingHours: HOURS, bookingRules: 'set menu for 10+', aiRoutingEnabled: true, rev: 4 })
  })

  it('a save without bookingHours (today’s form) keeps the stored hours', async () => {
    const stored = { ...STORED, bookingHours: HOURS }
    const rec = use([read(stored), read(stored), { data: [{ id: RID }] }])
    expect((await PUT(req({ mode: 'simple', bookingRules: 'x' }))).status).toBe(200)
    expect(written(updates(rec.queries)[0]).bookingHours).toEqual(HOURS)
  })

  it('AC-2: bad hours → 400 with per-path field errors, nothing written', async () => {
    const rec = use([read(STORED)])
    const bad = {
      ...HOURS,
      weekly: { ...HOURS.weekly, wed: [{ first: '21:00', last: '18:00' }] },
      special: [{ date: '2026-11-19', periods: [] }],
      info: { address: '', phone: '', mapUrl: 'javascript:alert(1)' },
    }
    const res = await PUT(req({ mode: 'simple', bookingHours: bad }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid',
      fields: {
        'bookingHours.weekly.wed.0': 'last_before_first',
        'bookingHours.special.2026-11-19': 'past',
        'bookingHours.info.mapUrl': 'invalid_https_url',
      },
    })
    expect(updates(rec.queries)).toHaveLength(0)
  })

  it('R1: staff cannot save booking hours', async () => {
    as('staff')
    const rec = use([read(STORED)])
    expect((await PUT(req({ mode: 'simple', bookingHours: HOURS }))).status).toBe(403)
    expect(updates(rec.queries)).toHaveLength(0)
  })
})

describe('GET booking settings with bookingHours', () => {
  // F1 (P3-5): the summary lists only special dates inside the window, so "today" is pinned (25 Dec is inside it).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-01T02:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('AC-1/AC-4: returns the hours and the summary in both languages', async () => {
    use([read({ ...STORED, bookingHours: HOURS })])
    const body = await (await GET()).json()
    expect(body.bookingHours).toEqual(HOURS)
    expect(body.summary).toEqual({
      en: 'Diners can book Tue–Sun 午市 12:00–14:00 and 晚市 18:00–21:30, every 30 minutes, 2 hours to 30 days ahead, up to 8 people. Closed: 25 Dec.',
      zh_hk: '可訂座時間：星期二至星期日 午市 12:00–14:00 及 晚市 18:00–21:30，每 30 分鐘一節，最少提前 2 小時、最遠 30 日內預約，每枱最多 8 位。休息：12月25日。',
    })
  })

  it('S1.4: special dates already past drop out of what the form loads', async () => {
    use([read({ ...STORED, bookingHours: { ...HOURS, special: [{ date: '2026-11-19', periods: [] }, ...HOURS.special] } })])
    expect((await (await GET()).json()).bookingHours.special).toEqual(HOURS.special)
  })

  it('F1 P3-5: a special date past the window is left out of the summary, as agents read it', async () => {
    vi.setSystemTime(new Date('2026-11-20T02:00:00.000Z')) // window ends 20 Dec
    use([read({ ...STORED, bookingHours: HOURS })])
    const body = await (await GET()).json()
    expect(body.bookingHours.special).toEqual(HOURS.special)
    expect(body.summary.en).not.toContain('25 Dec')
    expect(body.summary.zh_hk).not.toContain('12月25日')
  })

  it('F1 P2-1: schedule switched off → the hours load, no summary (diners pick any time)', async () => {
    use([read({ ...STORED, bookingHours: { ...HOURS, scheduleEnabled: false } })])
    const body = await (await GET()).json()
    expect(body.bookingHours.scheduleEnabled).toBe(false)
    expect(body.summary).toBeNull()
  })

  it('AC-5: never configured → bookingHours and summary are null', async () => {
    use([read(STORED)])
    const body = await (await GET()).json()
    expect(body.bookingHours).toBeNull()
    expect(body.summary).toBeNull()
  })
})
