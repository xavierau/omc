// BOOK-001 W3-07: the reminder cron route is Bearer CRON_SECRET only (as
// /api/cron/campaigns); with it, one run of sendBookingReminders.
// BOOK-003 review F3 (R41): the same */5 run deletes unverified agent
// bookings older than an hour, as its own step that runs even when the
// reminder step throws. BOOK-014 (R55, R57): and lapses expired deposit holds,
// its own step too.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/application/booking/send-booking-reminders', () => ({ sendBookingReminders: vi.fn() }))
vi.mock('@/application/booking/purge-unverified-bookings', () => ({ purgeUnverifiedBookings: vi.fn() }))
vi.mock('@/application/booking/booking-deps', () => ({
  bookingReminderDeps: vi.fn(() => ({ marker: 'deps' })),
  unverifiedBookingPurgeDeps: vi.fn(() => ({ marker: 'purge-deps' })),
}))
vi.mock('@/application/payments/expire-deposits', () => ({ expireDeposits: vi.fn() }))
vi.mock('@/application/payments/redrive-stalled-refunds', () => ({ redriveStalledRefunds: vi.fn() }))
vi.mock('@/application/payments/payment-deps', () => ({
  expireDepositsDeps: vi.fn(() => ({ marker: 'expiry-deps' })),
  redriveRefundsDeps: vi.fn(() => ({ marker: 'redrive-deps' })),
}))

import { sendBookingReminders } from '@/application/booking/send-booking-reminders'
import { purgeUnverifiedBookings } from '@/application/booking/purge-unverified-bookings'
import { expireDeposits } from '@/application/payments/expire-deposits'
import { redriveStalledRefunds } from '@/application/payments/redrive-stalled-refunds'
import { GET, POST } from '../route'

const SECRET = 'test-cron-secret'
const req = (auth: string | null) =>
  new NextRequest('http://localhost/api/cron/booking-reminders', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.mocked(sendBookingReminders).mockResolvedValue({ candidates: 1, due: 1, sent: 1, notDelivered: 0, claimLost: 0 })
  vi.mocked(purgeUnverifiedBookings).mockResolvedValue({ unverifiedDeleted: 2 })
  vi.mocked(expireDeposits).mockResolvedValue({ depositsLapsed: 3, sessionsClosed: 2 })
  vi.mocked(redriveStalledRefunds).mockResolvedValue({ refundsRedriven: 1, lateRefundsRetried: 0 })
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/cron/booking-reminders', () => {
  it.each([null, 'Bearer wrong', `Basic ${SECRET}`])('401 for authorization %s, nothing sent', async (auth) => {
    expect((await GET(req(auth))).status).toBe(401)
    expect(sendBookingReminders).not.toHaveBeenCalled()
    expect(purgeUnverifiedBookings).not.toHaveBeenCalled()
    expect(expireDeposits).not.toHaveBeenCalled()
    expect(redriveStalledRefunds).not.toHaveBeenCalled()
  })

  it('401 when CRON_SECRET is unset, even for "Bearer undefined"', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(req('Bearer undefined'))).status).toBe(401)
    expect((await GET(req('Bearer '))).status).toBe(401)
    expect(sendBookingReminders).not.toHaveBeenCalled()
  })

  it.each([['GET', GET], ['POST', POST]] as const)('%s with the bearer runs one pass and returns its counts', async (_m, handler) => {
    const res = await handler(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ candidates: 1, due: 1, sent: 1, notDelivered: 0, claimLost: 0, unverifiedDeleted: 2, depositsLapsed: 3, sessionsClosed: 2, refundsRedriven: 1, lateRefundsRetried: 0 })
    expect(sendBookingReminders).toHaveBeenCalledWith({ marker: 'deps' })
    expect(purgeUnverifiedBookings).toHaveBeenCalledTimes(1)
    expect(purgeUnverifiedBookings).toHaveBeenCalledWith({ marker: 'purge-deps' })
    expect(expireDeposits).toHaveBeenCalledWith({ marker: 'expiry-deps' })
    expect(redriveStalledRefunds).toHaveBeenCalledWith({ marker: 'redrive-deps' })
  })

  it('BOOK-014 review finding 1b: the stalled-refund sweep runs when every other step throws; its own failure is a 500 naming it, without internals', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(sendBookingReminders).mockRejectedValue(new Error('x'))
    vi.mocked(purgeUnverifiedBookings).mockRejectedValue(new Error('y'))
    vi.mocked(expireDeposits).mockRejectedValue(new Error('z'))
    const ran = await GET(req(`Bearer ${SECRET}`))
    expect(redriveStalledRefunds).toHaveBeenCalledTimes(1)
    expect(await ran.json()).toMatchObject({ refundsRedriven: 1 })

    vi.mocked(sendBookingReminders).mockResolvedValue({ candidates: 0, due: 0, sent: 0, notDelivered: 0, claimLost: 0 })
    vi.mocked(purgeUnverifiedBookings).mockResolvedValue({ unverifiedDeleted: 0 })
    vi.mocked(expireDeposits).mockResolvedValue({ depositsLapsed: 0, sessionsClosed: 0 })
    vi.mocked(redriveStalledRefunds).mockRejectedValue(new Error('rk_live_SECRET leaked'))
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(500)
    const body = JSON.stringify(await res.json())
    expect(body).toContain('Failed to re-drive stalled deposit refunds')
    expect(body).not.toContain('rk_live')
  })

  it('BOOK-014: the deposit expiry step runs when both other steps throw; its own failure is a 500 naming it, without internals', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(sendBookingReminders).mockRejectedValue(new Error('x'))
    vi.mocked(purgeUnverifiedBookings).mockRejectedValue(new Error('y'))
    const ran = await GET(req(`Bearer ${SECRET}`))
    expect(expireDeposits).toHaveBeenCalledTimes(1)
    expect(await ran.json()).toMatchObject({ depositsLapsed: 3 })

    vi.mocked(sendBookingReminders).mockResolvedValue({ candidates: 0, due: 0, sent: 0, notDelivered: 0, claimLost: 0 })
    vi.mocked(purgeUnverifiedBookings).mockResolvedValue({ unverifiedDeleted: 0 })
    vi.mocked(expireDeposits).mockRejectedValue(new Error('sk_test_SECRET leaked'))
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(500)
    const body = JSON.stringify(await res.json())
    expect(body).toContain('Failed to lapse expired deposit holds')
    expect(body).not.toContain('sk_test')
  })

  it('F3 (R41): the unverified purge still runs when the reminder step throws; 500 without internals', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(sendBookingReminders).mockRejectedValue(new Error('kapso password wrong'))
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(purgeUnverifiedBookings).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    const body = JSON.stringify(await res.json())
    expect(body).toContain('unverifiedDeleted')
    expect(body).not.toContain('password')
  })

  it('F3: a failing purge does not stop the reminders; 500 names the purge step only', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(purgeUnverifiedBookings).mockRejectedValue(new Error('db password wrong'))
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(sendBookingReminders).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ sent: 1 })
    expect(JSON.stringify(body)).not.toContain('password')
    expect(JSON.stringify(errors.mock.calls)).not.toContain('password')
  })

  it('500 without internals when the pass throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(sendBookingReminders).mockRejectedValue(new Error('db password wrong'))
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('password')
  })
})
