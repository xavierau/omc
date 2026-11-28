// BOOK-001 W3-08 (R19): the retention cron route is Bearer CRON_SECRET only;
// with it, one purge pass.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/application/booking/purge-booking-pii', () => ({ purgeBookingPii: vi.fn() }))
vi.mock('@/application/booking/booking-deps', () => ({ bookingRetentionDeps: vi.fn(() => ({ marker: 'deps' })) }))

import { purgeBookingPii } from '@/application/booking/purge-booking-pii'
import { GET, POST } from '../route'

const SECRET = 'test-cron-secret'
const req = (auth: string | null) =>
  new NextRequest('http://localhost/api/cron/booking-retention', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.mocked(purgeBookingPii).mockResolvedValue({ purged: 3, cutoffDate: '2026-05-16' })
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/cron/booking-retention', () => {
  it.each([null, 'Bearer wrong'])('401 for authorization %s, nothing purged', async (auth) => {
    expect((await GET(req(auth))).status).toBe(401)
    expect(purgeBookingPii).not.toHaveBeenCalled()
  })

  it('401 when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await POST(req('Bearer undefined'))).status).toBe(401)
    expect(purgeBookingPii).not.toHaveBeenCalled()
  })

  it.each([['GET', GET], ['POST', POST]] as const)('%s with the bearer purges once and returns the count', async (_m, handler) => {
    const res = await handler(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ purged: 3, cutoffDate: '2026-05-16' })
    expect(purgeBookingPii).toHaveBeenCalledWith({ marker: 'deps' })
  })
})
