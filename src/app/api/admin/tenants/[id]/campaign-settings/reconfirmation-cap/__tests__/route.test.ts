import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/infrastructure/supabase/audit-logger', () => ({
  logAdminAction: vi.fn(),
  extractIp: vi.fn().mockReturnValue('1.2.3.4'),
}))
vi.mock('@/infrastructure/supabase/repositories/campaign-settings-repository', () => ({
  setReconfirmationDailyCap: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { logAdminAction } from '@/infrastructure/supabase/audit-logger'
import { setReconfirmationDailyCap } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import { PATCH } from '../route'

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function patchReq(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/tenants/${TENANT_ID}/campaign-settings/reconfirmation-cap`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
}

function ctx(tid = TENANT_ID) {
  return { params: Promise.resolve({ id: tid }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
  vi.mocked(setReconfirmationDailyCap).mockResolvedValue(undefined)
})

describe('PATCH /api/admin/tenants/[id]/campaign-settings/reconfirmation-cap', () => {
  it('returns 401 when not signed in', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await PATCH(patchReq({ cap: 75 }), ctx())
    expect(r.status).toBe(401)
  })

  it('returns 403 when caller is tenant-manager (not platform-admin)', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(
      new AuthError('Forbidden: not a platform admin', 403)
    )
    const r = await PATCH(patchReq({ cap: 75 }), ctx())
    expect(r.status).toBe(403)
  })

  it('returns 429 when rate-limited', async () => {
    vi.mocked(checkAdminRateLimit).mockReturnValueOnce({ success: false, remaining: 0 })
    const r = await PATCH(patchReq({ cap: 75 }), ctx())
    expect(r.status).toBe(429)
  })

  it('returns 400 for invalid tenant UUID', async () => {
    const r = await PATCH(patchReq({ cap: 75 }), ctx('bad'))
    expect(r.status).toBe(400)
  })

  it('returns 400 when cap is below 50', async () => {
    const r = await PATCH(patchReq({ cap: 49 }), ctx())
    expect(r.status).toBe(400)
    expect(setReconfirmationDailyCap).not.toHaveBeenCalled()
  })

  it('returns 400 when cap is above 100', async () => {
    const r = await PATCH(patchReq({ cap: 101 }), ctx())
    expect(r.status).toBe(400)
    expect(setReconfirmationDailyCap).not.toHaveBeenCalled()
  })

  it('returns 400 when cap is missing', async () => {
    const r = await PATCH(patchReq({}), ctx())
    expect(r.status).toBe(400)
  })

  it('returns 400 when cap is not an integer', async () => {
    const r = await PATCH(patchReq({ cap: 75.5 }), ctx())
    expect(r.status).toBe(400)
  })

  it('returns 200 with the new cap when cap=50 (boundary low)', async () => {
    const r = await PATCH(patchReq({ cap: 50 }), ctx())
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ cap: 50 })
    expect(setReconfirmationDailyCap).toHaveBeenCalledWith(TENANT_ID, 50)
  })

  it('returns 200 with the new cap when cap=100 (boundary high)', async () => {
    const r = await PATCH(patchReq({ cap: 100 }), ctx())
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ cap: 100 })
  })

  it('writes a reconfirmation.cap.update audit log on success', async () => {
    await PATCH(patchReq({ cap: 75 }), ctx())
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'reconfirmation.cap.update',
        resourceType: 'tenant_campaign_settings',
        resourceId: TENANT_ID,
        details: expect.objectContaining({ cap: 75 }),
      })
    )
  })

  it('returns 500 on unexpected repo error', async () => {
    vi.mocked(setReconfirmationDailyCap).mockRejectedValueOnce(new Error('db down'))
    const r = await PATCH(patchReq({ cap: 75 }), ctx())
    expect(r.status).toBe(500)
  })
})
