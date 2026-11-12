import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitBookingRequest, type SubmitBookingDeps } from '../booking/submit-booking-request'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'

const A = 'rest-a'
const B = 'rest-b'
const PHONE = '+85291234567'
const TOKEN = 'A'.repeat(43)
const NOW = new Date('2026-11-12T02:00:00.000Z') // 10:00 in Hong Kong
const BODY = { date: '2026-11-13', time: '19:30', partySize: 4, name: 'Chan Tai Man', notes: 'nut allergy' }

let tokens: FakeBookingTokens
let requests: FakeBookingRequests
let settings: FakeBookingSettings
let sender: FakeBookingSender
let limiter: FakeRateLimiter
let members: { findMemberId: ReturnType<typeof vi.fn> }
let deps: SubmitBookingDeps

beforeEach(() => {
  vi.restoreAllMocks()
  tokens = new FakeBookingTokens()
  tokens.add({ token: TOKEN, restaurantId: A, phone: PHONE, expiresAt: '2026-11-13T02:00:00.000Z' })
  requests = new FakeBookingRequests()
  settings = new FakeBookingSettings()
  settings.setConfig(A, { mode: 'simple' })
  settings.restaurants.set(A, { name: 'Kushiro', logoUrl: null, whatsappNumber: '+85220000001' })
  sender = new FakeBookingSender()
  const clock = new FakeClock(NOW)
  limiter = new FakeRateLimiter(clock)
  members = { findMemberId: vi.fn().mockResolvedValue(null) }
  deps = { tokens, requests, settings, members, sender, limiter, now: () => clock.now() }
})

const submit = (body: unknown = BODY, token = TOKEN, clientIp = '203.0.113.7') =>
  submitBookingRequest(deps, { token, body, clientIp })

describe('submitBookingRequest — R1 single use', () => {
  it('two concurrent submits with one token store exactly one booking; the other is told already used', async () => {
    const results = await Promise.all([submit(), submit()])
    expect(requests.rows).toHaveLength(1)
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'token_unusable', state: 'consumed' })
  })

  it('refuses an expired token and stores nothing', async () => {
    tokens.rows[0].expiresAt = '2026-11-12T01:00:00.000Z'
    expect(await submit()).toEqual({ ok: false, reason: 'token_unusable', state: 'expired' })
    expect(requests.rows).toHaveLength(0)
  })

  it('accepts a no-expiry token exactly once', async () => {
    tokens.rows[0].expiresAt = null
    expect((await submit()).ok).toBe(true)
    expect(await submit()).toEqual({ ok: false, reason: 'token_unusable', state: 'consumed' })
    expect(requests.rows).toHaveLength(1)
  })

  it('refuses an unknown token', async () => {
    expect(await submit(BODY, 'Z'.repeat(43))).toEqual({ ok: false, reason: 'token_unusable', state: 'unknown' })
  })

  it('re-arms the link when the insert fails, so the diner can retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    requests.failInsert = true
    expect(await submit()).toEqual({ ok: false, reason: 'failed' })
    expect(tokens.rows[0].consumedAt).toBeNull()
  })
})

describe('submitBookingRequest — R2 identity from the token only', () => {
  it("stores for the token's restaurant and phone even when the body names restaurant B and another phone", async () => {
    settings.setConfig(B, { mode: 'simple' })
    const result = await submit({ ...BODY, restaurantId: B, restaurantSlug: 'rest-b', phone: '+85299999999' })
    expect(result.ok).toBe(true)
    expect(requests.rows[0]).toMatchObject({ restaurantId: A, phone: PHONE })
  })
})

describe('submitBookingRequest — R3 / AC-11 validation stores nothing and keeps the link', () => {
  it('returns per-field errors, no row, token still valid', async () => {
    const result = await submit({ ...BODY, date: '2026-11-11', partySize: 0 })
    expect(result).toEqual({ ok: false, reason: 'invalid', errors: { date: 'past', partySize: 'too_small' } })
    expect(requests.rows).toHaveLength(0)
    expect(tokens.rows[0].consumedAt).toBeNull()
  })

  it("uses the restaurant's maximum party size", async () => {
    settings.setConfig(A, { mode: 'simple', maxPartySize: 6 })
    expect(await submit({ ...BODY, partySize: 7 })).toMatchObject({ reason: 'invalid', errors: { partySize: 'too_large' } })
  })
})

describe('submitBookingRequest — R11 abuse limits', () => {
  it('refuses a 4th pending booking for the same phone at the same restaurant', async () => {
    for (let i = 0; i < 3; i++) {
      const token = `${i}`.repeat(43)
      tokens.add({ token, restaurantId: A, phone: PHONE })
      expect((await submit(BODY, token)).ok).toBe(true)
    }
    expect(await submit()).toEqual({ ok: false, reason: 'too_many_pending' })
    expect(requests.rows).toHaveLength(3)
    expect(tokens.rows[0].consumedAt).toBeNull()
  })

  it('returns rate_limited on the 11th submit from one IP within 60s', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await submit({}, 'Q'.repeat(43))).ok).toBe(false)
    }
    expect(await submit()).toEqual({ ok: false, reason: 'rate_limited' })
    expect(requests.rows).toHaveLength(0)
    expect((await submit(BODY, TOKEN, '198.51.100.1')).ok).toBe(true)
  })

  it('fails open when the limiter is down (token and pending cap still apply)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(limiter, 'incrWindow').mockRejectedValue(new Error('redis down'))
    expect((await submit()).ok).toBe(true)
  })
})

describe('submitBookingRequest — R21 / AC-10 non-member', () => {
  it('stores a pending booking, consumes the token, and sends the received message without enrolling', async () => {
    const result = await submit()
    expect(result).toEqual({ ok: true, bookingId: requests.rows[0].id, delivered: true })
    expect(requests.rows[0]).toMatchObject({ status: 'pending', memberId: null, source: 'chat', notes: 'nut allergy' })
    expect(tokens.rows[0].consumedAt).not.toBeNull()
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]).toMatchObject({ kind: 'received', phone: PHONE, restaurantId: A })
    // The use case's only writes are the token claim and the booking row:
    // it has no member or consent dependency it could write through.
    expect(Object.keys(deps).sort()).toEqual(['limiter', 'members', 'now', 'requests', 'sender', 'settings', 'tokens'])
    expect(Object.keys(members)).toEqual(['findMemberId'])
  })

  it('links an existing member without changing them', async () => {
    members.findMemberId.mockResolvedValue('member-1')
    await submit()
    expect(requests.rows[0].memberId).toBe('member-1')
    expect(members.findMemberId).toHaveBeenCalledWith(A, PHONE)
  })
})

describe('submitBookingRequest — AC-14 warning and AC-3 off', () => {
  it('saves the booking and reports delivered:false when the message cannot be sent', async () => {
    sender.result = { delivered: false, reason: 'outside_window' }
    expect(await submit()).toEqual({ ok: true, bookingId: requests.rows[0].id, delivered: false })
    expect(requests.rows).toHaveLength(1)
  })

  it.each(['off', 'external'] as const)('refuses a submit when the restaurant is in %s mode', async (mode) => {
    settings.setConfig(A, { mode })
    expect(await submit()).toEqual({ ok: false, reason: 'booking_unavailable' })
    expect(tokens.rows[0].consumedAt).toBeNull()
  })
})

describe('submitBookingRequest — R8 no PII in logs', () => {
  it('logs no full phone, name or notes on the insert-failure and send-failure paths', async () => {
    const logged: unknown[][] = []
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args))
    }
    requests.failInsert = true
    await submit()
    requests.failInsert = false
    vi.spyOn(limiter, 'incrWindow').mockRejectedValue(new Error('redis down'))
    sender.result = { delivered: false, reason: 'send_failed' }
    await submit({ ...BODY, date: 'not-a-date' })
    await submit()
    const text = JSON.stringify(logged)
    expect(logged.length).toBeGreaterThan(0)
    for (const secret of [PHONE, '91234567', 'Chan Tai Man', 'nut allergy']) expect(text).not.toContain(secret)
  })
})
