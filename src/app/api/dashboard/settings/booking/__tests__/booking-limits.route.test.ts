// BOOK-010 AC-1/AC-2 (spec S1): guest limits save inside bookingHours through
// the admin booking settings PUT; GET returns them and the summary names
// them. The real repository runs; only Supabase is recorded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { recordingSupabase, type RecordedQuery } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/application/booking/booking-template-deps', () => ({
  bookingTemplateOverviewFor: vi.fn(async () => ({ templates: null, slots: [] })),
  bookingTemplateStatusesFor: vi.fn(async () => null),
  provisionBookingTemplatesFor: vi.fn(async () => null),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import { GET, PUT } from '../route'

const RID = 'rest-1'
const OPEN = [{ label: '晚市', first: '18:00', last: '21:30' }]
const HOURS: BookingHours = { ...EMPTY_BOOKING_HOURS, weekly: { ...EMPTY_BOOKING_HOURS.weekly, sat: OPEN } }
const LIMITED: BookingHours = { ...HOURS, limits: { perSlot: 30, perMeal: 60 } }
const STORED = { mode: 'simple', maxPartySize: 8, rev: 3 }

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/dashboard/settings/booking', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const read = (config: unknown) => ({ data: { booking_config: config } })
const updates = (queries: RecordedQuery[]) => queries.filter((q) => q.calls.some(([m]) => m === 'update'))
const written = (q: RecordedQuery) =>
  (q.calls.find(([m]) => m === 'update')?.[1] as { booking_config: Record<string, unknown> }).booking_config

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T02:00:00Z'))
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: RID, role: 'admin', tenantStatus: 'active' })
})
afterEach(() => vi.useRealTimers())

describe('booking settings carry guest limits (BOOK-010)', () => {
  it('AC-1: PUT saves 30 per slot / 60 per meal; GET returns them and the summary line', async () => {
    const rec = use([read(STORED), read(STORED), { data: [{ id: RID }] }])
    const res = await PUT(req({ mode: 'simple', maxPartySize: 8, bookingHours: LIMITED }))
    expect(res.status).toBe(200)
    expect(written(updates(rec.queries)[0]).bookingHours).toEqual(LIMITED)

    use([read({ ...STORED, bookingHours: LIMITED })])
    const body = await (await GET()).json()
    expect(body.bookingHours.limits).toEqual({ perSlot: 30, perMeal: 60 })
    expect(body.summary.zh_hk).toContain('每個時段最多 30 位，每餐最多 60 位')
    expect(body.summary.en).toContain('Up to 30 guests per time slot, up to 60 guests per meal.')
  })

  it.each([
    [{ perSlot: 0, perMeal: 60 }, { 'bookingHours.limits.perSlot': 'invalid' }],
    [{ perSlot: 30, perMeal: 1.5 }, { 'bookingHours.limits.perMeal': 'invalid' }],
    [{ perSlot: 'ten', perMeal: null }, { 'bookingHours.limits.perSlot': 'invalid' }],
    [{ perSlot: 61, perMeal: 60 }, { 'bookingHours.limits.perSlot': 'above_meal' }],
  ])('AC-2: %j → 400 with the field error, nothing written', async (limits, fields) => {
    const rec = use([read(STORED)])
    const res = await PUT(req({ mode: 'simple', bookingHours: { ...HOURS, limits } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', fields })
    expect(updates(rec.queries)).toHaveLength(0)
  })

  it('AC-3: hours without limits load without a limits field and an unchanged summary', async () => {
    use([read({ ...STORED, bookingHours: HOURS })])
    const body = await (await GET()).json()
    expect(body.bookingHours).not.toHaveProperty('limits')
    expect(body.summary.zh_hk).not.toContain('每個時段')
  })
})
