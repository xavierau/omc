import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/booking-config-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getBookingConfig, updateBookingConfig } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
import { PUT } from '../route'

const RID = 'rest-1'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/dashboard/settings/booking', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function as(role: string) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: RID, role, tenantStatus: 'active' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBookingConfig).mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG })
  vi.mocked(updateBookingConfig).mockResolvedValue()
})

describe('PUT /api/dashboard/settings/booking (R14, AC-1/2/3)', () => {
  it('staff role → 403 and settings unchanged', async () => {
    as('staff')
    const res = await PUT(req({ mode: 'external', externalUrl: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(updateBookingConfig).not.toHaveBeenCalled()
  })

  it('admin saves simple mode with lifetimes as positive ints or null (no expiry)', async () => {
    as('admin')
    const res = await PUT(req({ mode: 'simple', chatLinkTtlHours: null, campaignLinkTtlHours: 72, maxPartySize: 10 }))
    expect(res.status).toBe(200)
    expect(updateBookingConfig).toHaveBeenCalledWith(RID, {
      ...DEFAULT_BOOKING_CONFIG, mode: 'simple', chatLinkTtlHours: null, campaignLinkTtlHours: 72, maxPartySize: 10,
    })
  })

  it('admin saves external mode with an https URL', async () => {
    as('admin')
    const res = await PUT(req({ mode: 'external', externalUrl: 'https://inline.app/booking/kushiro' }))
    expect(res.status).toBe(200)
    expect(vi.mocked(updateBookingConfig).mock.calls[0][1]).toMatchObject({
      mode: 'external', externalUrl: 'https://inline.app/booking/kushiro',
    })
  })

  it('admin saves off mode', async () => {
    as('admin')
    expect((await PUT(req({ mode: 'off' }))).status).toBe(200)
    expect(vi.mocked(updateBookingConfig).mock.calls[0][1].mode).toBe('off')
  })

  it.each(['javascript:alert(1)', 'http://inline.app/x', 'data:text/html,<b>x</b>', 'inline.app/x', 'https://'])(
    'rejects external URL %s with 400 and saves nothing',
    async (externalUrl) => {
      as('admin')
      const res = await PUT(req({ mode: 'external', externalUrl }))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', fields: { externalUrl: 'invalid_https_url' } })
      expect(updateBookingConfig).not.toHaveBeenCalled()
    }
  )

  it.each([0, -5, 1.5, 'abc'])('rejects lifetime %j with 400', async (ttl) => {
    as('admin')
    expect((await PUT(req({ mode: 'simple', campaignLinkTtlHours: ttl }))).status).toBe(400)
    expect(updateBookingConfig).not.toHaveBeenCalled()
  })

  it('rejects a body that names a restaurant: the tenant comes only from the session', async () => {
    as('admin')
    const res = await PUT(req({ mode: 'off', restaurantId: 'other' }))
    expect(res.status).toBe(400)
    expect(updateBookingConfig).not.toHaveBeenCalled()
  })
})
