import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { updateRestaurantRedirect } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { PATCH } from '../contact-redirect/route'

const RESTAURANT_ID = 'rest-1'

function req(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/dashboard/settings/contact-redirect',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

function tenantOk() {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1',
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
}

describe('PATCH /api/dashboard/settings/contact-redirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists a valid number + label, tenant-scoped', async () => {
    tenantOk()
    vi.mocked(updateRestaurantRedirect).mockResolvedValue()

    const res = await PATCH(
      req({ redirectNumber: '+85291234567', redirectLabel: 'VIP Hotline' })
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ success: true })
    expect(updateRestaurantRedirect).toHaveBeenCalledWith(RESTAURANT_ID, {
      redirectNumber: '+85291234567',
      redirectLabel: 'VIP Hotline',
    })
  })

  it('rejects an invalid number with 400 and does not touch the repo', async () => {
    tenantOk()

    const res = await PATCH(
      req({ redirectNumber: 'not-a-number', redirectLabel: 'Hi' })
    )

    expect(res.status).toBe(400)
    expect(updateRestaurantRedirect).not.toHaveBeenCalled()
  })

  it('clears the redirect when the number is empty/whitespace', async () => {
    tenantOk()
    vi.mocked(updateRestaurantRedirect).mockResolvedValue()

    const res = await PATCH(
      req({ redirectNumber: '   ', redirectLabel: 'Contact us' })
    )

    expect(res.status).toBe(200)
    expect(updateRestaurantRedirect).toHaveBeenCalledWith(RESTAURANT_ID, {
      redirectNumber: null,
      redirectLabel: 'Contact us',
    })
  })

  it('clears the redirect when the number is null', async () => {
    tenantOk()
    vi.mocked(updateRestaurantRedirect).mockResolvedValue()

    await PATCH(req({ redirectNumber: null, redirectLabel: 'Contact us' }))

    expect(updateRestaurantRedirect).toHaveBeenCalledWith(RESTAURANT_ID, {
      redirectNumber: null,
      redirectLabel: 'Contact us',
    })
  })

  it('falls back to the default label when the label is empty', async () => {
    tenantOk()
    vi.mocked(updateRestaurantRedirect).mockResolvedValue()

    await PATCH(req({ redirectNumber: '+85291234567', redirectLabel: '  ' }))

    expect(updateRestaurantRedirect).toHaveBeenCalledWith(RESTAURANT_ID, {
      redirectNumber: '+85291234567',
      redirectLabel: 'Contact us',
    })
  })

  it('propagates the AuthError status when there is no tenant context', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden', 403))

    const res = await PATCH(
      req({ redirectNumber: '+85291234567', redirectLabel: 'Hi' })
    )

    expect(res.status).toBe(403)
    expect(updateRestaurantRedirect).not.toHaveBeenCalled()
  })
})
