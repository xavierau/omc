// BOOK-001 W3-07: the reminder cron route is Bearer CRON_SECRET only (as
// /api/cron/campaigns); with it, one run of sendBookingReminders.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/application/booking/send-booking-reminders', () => ({ sendBookingReminders: vi.fn() }))
vi.mock('@/application/booking/booking-deps', () => ({ bookingReminderDeps: vi.fn(() => ({ marker: 'deps' })) }))

import { sendBookingReminders } from '@/application/booking/send-booking-reminders'
import { GET, POST } from '../route'

const SECRET = 'test-cron-secret'
const req = (auth: string | null) =>
  new NextRequest('http://localhost/api/cron/booking-reminders', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.mocked(sendBookingReminders).mockResolvedValue({ candidates: 1, due: 1, sent: 1, notDelivered: 0, claimLost: 0 })
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/cron/booking-reminders', () => {
  it.each([null, 'Bearer wrong', `Basic ${SECRET}`])('401 for authorization %s, nothing sent', async (auth) => {
    expect((await GET(req(auth))).status).toBe(401)
    expect(sendBookingReminders).not.toHaveBeenCalled()
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
    expect(await res.json()).toEqual({ candidates: 1, due: 1, sent: 1, notDelivered: 0, claimLost: 0 })
    expect(sendBookingReminders).toHaveBeenCalledWith({ marker: 'deps' })
  })

  it('500 without internals when the pass throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(sendBookingReminders).mockRejectedValue(new Error('db password wrong'))
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('password')
  })
})
