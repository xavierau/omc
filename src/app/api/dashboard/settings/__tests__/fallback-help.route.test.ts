import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { updateFallbackHelpEnabled } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { PATCH } from '../fallback-help/route'

const RESTAURANT_ID = 'rest-1'

function req(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/dashboard/settings/fallback-help',
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

describe('PATCH /api/dashboard/settings/fallback-help', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists helpEnabled=false, tenant-scoped', async () => {
    tenantOk()
    vi.mocked(updateFallbackHelpEnabled).mockResolvedValue()

    const res = await PATCH(req({ helpEnabled: false }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ success: true })
    expect(updateFallbackHelpEnabled).toHaveBeenCalledWith(RESTAURANT_ID, false)
  })

  it('persists helpEnabled=true', async () => {
    tenantOk()
    vi.mocked(updateFallbackHelpEnabled).mockResolvedValue()

    await PATCH(req({ helpEnabled: true }))

    expect(updateFallbackHelpEnabled).toHaveBeenCalledWith(RESTAURANT_ID, true)
  })

  it('rejects a non-boolean helpEnabled with 400 and does not touch the repo', async () => {
    tenantOk()

    const res = await PATCH(req({ helpEnabled: 'yes' }))

    expect(res.status).toBe(400)
    expect(updateFallbackHelpEnabled).not.toHaveBeenCalled()
  })

  it('rejects a missing helpEnabled with 400', async () => {
    tenantOk()

    const res = await PATCH(req({}))

    expect(res.status).toBe(400)
    expect(updateFallbackHelpEnabled).not.toHaveBeenCalled()
  })

  it('propagates the AuthError status when there is no tenant context', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden', 403))

    const res = await PATCH(req({ helpEnabled: false }))

    expect(res.status).toBe(403)
    expect(updateFallbackHelpEnabled).not.toHaveBeenCalled()
  })
})
