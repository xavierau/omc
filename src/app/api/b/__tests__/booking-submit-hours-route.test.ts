// BOOK-009 AC-8 / AC-10 / AC-5: the booking page submit enforces the
// restaurant's booking hours and terms, and stores the accepted terms.
// Now is 2026-11-12 10:00 HK (Thursday); 2026-11-16 is a Monday.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import type { SubmitBookingDeps } from '@/application/booking/submit-booking-request'
import type { BookingHours } from '@/domain/value-objects/booking-hours'

const holder: { deps: SubmitBookingDeps | null } = { deps: null }
vi.mock('@/application/booking/booking-deps', () => ({ submitBookingDeps: () => holder.deps }))

import { POST } from '../[token]/route'

const A = 'rest-a'
const PHONE = '+85291234567'
const TOKEN = 'A'.repeat(43)
const BODY = { date: '2026-11-13', time: '19:30', partySize: 4, name: 'Chan Tai Man', notes: null }
const OPEN = [{ first: '12:00', last: '14:00' }, { first: '18:00', last: '21:30' }]
const HOURS: BookingHours = {
  weekly: { mon: [], tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN, sun: OPEN },
  intervalMinutes: 30,
  noticeHours: 3,
  aheadDays: 30,
  special: [{ date: '2026-11-14', periods: [] }],
  tableMinutes: null,
  terms: { zh_hk: '', en: '' },
  info: { address: '', phone: '', mapUrl: '' },
}
const TERMS = { zh_hk: '請準時到達。', en: 'Please arrive on time.' }

let requests: FakeBookingRequests
let settings: FakeBookingSettings

beforeEach(() => {
  const tokens = new FakeBookingTokens()
  tokens.add({ token: TOKEN, restaurantId: A, phone: PHONE })
  requests = new FakeBookingRequests()
  settings = new FakeBookingSettings()
  settings.setConfig(A, { mode: 'simple', maxPartySize: 20, bookingHours: HOURS })
  const clock = new FakeClock(new Date('2026-11-12T02:00:00.000Z'))
  const members = { findMemberId: vi.fn().mockResolvedValue(null) }
  holder.deps = {
    tokens, requests, settings, members, sender: new FakeBookingSender(), limiter: new FakeRateLimiter(clock), now: () => clock.now(),
  }
})

function post(body: unknown) {
  const req = new NextRequest(`https://app.ohmyclient.io/api/b/${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.9' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ token: TOKEN }) })
}

describe('POST /api/b/[token] with booking hours (BOOK-009)', () => {
  it('a slot the restaurant takes is stored, with no terms columns when there are no terms', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(200)
    expect(requests.rows).toHaveLength(1)
    expect(requests.rows[0]).not.toHaveProperty('termsAcceptedAt')
  })

  it.each([
    ['a closed weekday', { date: '2026-11-16' }, { date: 'closed_day' }],
    ['a special closed date', { date: '2026-11-14' }, { date: 'closed_day' }],
    ['a time off the grid', { time: '19:15' }, { time: 'outside_hours' }],
    ['inside the 3 h notice', { date: '2026-11-12', time: '12:00' }, { time: 'too_soon' }],
    ['past the 30-day window', { date: '2026-12-13' }, { time: 'too_far' }],
  ])('AC-8: %s → 400 with the field code and no booking', async (_label, patch, fields) => {
    const res = await post({ ...BODY, ...patch })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', fields })
    expect(requests.rows).toHaveLength(0)
  })

  it('AC-8: terms set and not accepted → 400 terms_required, no booking', async () => {
    settings.setConfig(A, { mode: 'simple', bookingHours: { ...HOURS, terms: TERMS } })
    const res = await post(BODY)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', fields: { acceptTerms: 'terms_required' } })
    expect(requests.rows).toHaveLength(0)
  })

  it('AC-10: accepted terms are stored with when and the exact text (both languages)', async () => {
    settings.setConfig(A, { mode: 'simple', bookingHours: { ...HOURS, terms: TERMS } })
    const res = await post({ ...BODY, acceptTerms: true })
    expect(res.status).toBe(200)
    expect(requests.rows[0]).toMatchObject({
      termsAcceptedAt: '2026-11-12T02:00:00.000Z',
      termsText: '請準時到達。\n\nPlease arrive on time.',
    })
  })

  it('AC-5: hours never set → any time is still accepted, as before', async () => {
    settings.setConfig(A, { mode: 'simple', maxPartySize: 20 })
    expect((await post({ ...BODY, date: '2026-11-16', time: '03:17' })).status).toBe(200)
    expect(requests.rows[0]).toMatchObject({ bookingDate: '2026-11-16', bookingTime: '03:17' })
  })
})
