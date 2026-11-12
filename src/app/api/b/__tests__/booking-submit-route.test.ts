import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import type { SubmitBookingDeps } from '@/application/booking/submit-booking-request'

const holder: { deps: SubmitBookingDeps | null } = { deps: null }
vi.mock('@/application/booking/booking-deps', () => ({ submitBookingDeps: () => holder.deps }))

import { POST } from '../[token]/route'

const A = 'rest-a'
const B = 'rest-b'
const PHONE = '+85291234567'
const TOKEN = 'A'.repeat(43)
const BODY = { date: '2026-11-13', time: '19:30', partySize: 4, name: 'Chan Tai Man', notes: 'window' }

let tokens: FakeBookingTokens
let requests: FakeBookingRequests
let sender: FakeBookingSender
type FindMemberId = (restaurantId: string, phone: string) => Promise<string | null>
let members: { findMemberId: Mock<FindMemberId> }

beforeEach(() => {
  tokens = new FakeBookingTokens()
  tokens.add({ token: TOKEN, restaurantId: A, phone: PHONE })
  requests = new FakeBookingRequests()
  const settings = new FakeBookingSettings()
  settings.setConfig(A, { mode: 'simple', maxPartySize: 20 })
  settings.setConfig(B, { mode: 'simple' })
  sender = new FakeBookingSender()
  const clock = new FakeClock(new Date('2026-11-12T02:00:00.000Z'))
  members = { findMemberId: vi.fn<FindMemberId>().mockResolvedValue(null) }
  holder.deps = { tokens, requests, settings, members, sender, limiter: new FakeRateLimiter(clock), now: () => clock.now() }
})

function post(body: unknown, opts: { token?: string; query?: string; ip?: string; raw?: string } = {}) {
  const token = opts.token ?? TOKEN
  const req = new NextRequest(`https://app.ohmyclient.io/api/b/${token}${opts.query ?? ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': opts.ip ?? '203.0.113.9' },
    body: opts.raw ?? JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ token }) })
}

function expectBookingHeaders(res: Response) {
  expect(res.headers.get('Cache-Control')).toContain('no-store')
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(res.headers.get('X-Robots-Tag')).toContain('noindex')
}

describe('POST /api/b/[token]', () => {
  it('R21/AC-10: a non-member submit stores a pending booking, consumes the token, sends received, enrols no one', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, delivered: true })
    expect(requests.rows).toHaveLength(1)
    expect(requests.rows[0]).toMatchObject({ status: 'pending', memberId: null, restaurantId: A })
    expect(tokens.rows[0].consumedAt).not.toBeNull()
    expect(sender.sent.map((s) => s.kind)).toEqual(['received'])
  })

  it('R2: restaurant B in the query string and body, plus another phone, still stores for A with the token phone', async () => {
    const res = await post(
      { ...BODY, restaurantId: B, restaurantSlug: 'rest-b', phone: '+85299999999' },
      { query: `?restaurant=${B}&slug=rest-b&phone=%2B85299999999` }
    )
    expect(res.status).toBe(200)
    expect(requests.rows[0]).toMatchObject({ restaurantId: A, phone: PHONE })
  })

  it.each([
    ['past date', { date: '2026-11-11' }, { date: 'past' }],
    ['bad time', { time: '7pm' }, { time: 'invalid' }],
    ['party size 0', { partySize: 0 }, { partySize: 'too_small' }],
    ['party size over max', { partySize: 21 }, { partySize: 'too_large' }],
    ['name over 60', { name: 'n'.repeat(61) }, { name: 'too_long' }],
    ['notes over 500', { notes: 'x'.repeat(501) }, { notes: 'too_long' }],
    ['missing name', { name: undefined }, { name: 'required' }],
    ['unknown field', { coupon: 'FREE' }, { coupon: 'unknown_field' }],
  ])('R3/AC-11: %s → 400 with the field error and no row', async (_label, patch, fields) => {
    const res = await post({ ...BODY, ...patch })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', fields })
    expect(requests.rows).toHaveLength(0)
    expectBookingHeaders(res)
  })

  it('R1: a second submit with the same token gets 410 already used', async () => {
    await post(BODY)
    const res = await post(BODY)
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'token_unusable', state: 'consumed' })
  })

  it('R11: the 11th submit from one IP within 60s gets 429', async () => {
    for (let i = 0; i < 10; i++) await post({}, { token: 'Q'.repeat(43) })
    const res = await post(BODY)
    expect(res.status).toBe(429)
    expect(requests.rows).toHaveLength(0)
    expectBookingHeaders(res)
  })

  it('R11: a 4th pending booking for one phone is refused with 409', async () => {
    for (const t of ['1', '2', '3']) {
      tokens.add({ token: t.repeat(43), restaurantId: A, phone: PHONE })
      expect((await post(BODY, { token: t.repeat(43) })).status).toBe(200)
    }
    const res = await post(BODY)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'too_many_pending' })
  })

  it('R7: success, gone and bad-JSON responses all carry no-store, no-referrer and noindex', async () => {
    expectBookingHeaders(await post(BODY))
    expectBookingHeaders(await post(BODY))
    expectBookingHeaders(await post(null, { raw: '{oops' }))
  })

  it('AC-14 warning: a failed received message still answers 200 with delivered:false', async () => {
    sender.result = { delivered: false, reason: 'outside_window' }
    const res = await post(BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, delivered: false })
  })
})
