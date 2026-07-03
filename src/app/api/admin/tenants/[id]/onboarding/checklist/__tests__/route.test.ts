import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/infrastructure/supabase/audit-logger', () => ({
  logAdminAction: vi.fn(),
  extractIp: vi.fn().mockReturnValue('1.2.3.4'),
}))
vi.mock('@/application/onboarding/update-checklist-item', () => ({
  updateChecklistItem: vi.fn(),
}))
vi.mock('@/application/onboarding/get-onboarding-state', () => ({
  getOnboardingState: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { logAdminAction } from '@/infrastructure/supabase/audit-logger'
import { updateChecklistItem } from '@/application/onboarding/update-checklist-item'
import { getOnboardingState } from '@/application/onboarding/get-onboarding-state'
import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import { PATCH } from '../route'

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const VIEW = { restaurantId: TENANT_ID } as never

function req(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/tenants/${TENANT_ID}/onboarding/checklist`,
    {
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

function ctx(id: string = TENANT_ID) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
  vi.mocked(updateChecklistItem).mockResolvedValue(
    TenantOnboardingState.createDefault({
      id: 'id-1',
      restaurantId: TENANT_ID,
      now: '2026-05-05T00:00:00.000Z',
    })
  )
  vi.mocked(getOnboardingState).mockResolvedValue(VIEW)
})

describe('PATCH /api/admin/tenants/[id]/onboarding/checklist', () => {
  it('returns 401 when not signed in', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await PATCH(req({ key: 'verified_meta_business', checked: true }), ctx())
    expect(r.status).toBe(401)
  })

  it('returns 429 when rate-limited', async () => {
    vi.mocked(checkAdminRateLimit).mockReturnValueOnce({ success: false, remaining: 0 })
    const r = await PATCH(req({ key: 'verified_meta_business', checked: true }), ctx())
    expect(r.status).toBe(429)
  })

  it('returns 400 for invalid tenant UUID', async () => {
    const r = await PATCH(req({ key: 'verified_meta_business', checked: true }), ctx('bad'))
    expect(r.status).toBe(400)
  })

  it('returns 400 for unknown checklist key', async () => {
    const r = await PATCH(req({ key: 'mystery', checked: true }), ctx())
    expect(r.status).toBe(400)
  })

  it('returns 400 when "checked" is not a boolean', async () => {
    const r = await PATCH(req({ key: 'verified_meta_business', checked: 'yes' }), ctx())
    expect(r.status).toBe(400)
  })

  it('writes an audit log on success', async () => {
    const r = await PATCH(req({ key: 'vertical_allowed', checked: true }), ctx())
    expect(r.status).toBe(200)
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'onboarding.checklist.update',
        resourceType: 'tenant',
        resourceId: TENANT_ID,
        details: expect.objectContaining({ key: 'vertical_allowed', checked: true }),
      })
    )
  })

  it('passes the auth user id as the actor', async () => {
    await PATCH(req({ key: 'vertical_allowed', checked: true }), ctx())
    expect(updateChecklistItem).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'admin-1' })
    )
  })

  it('returns 200 with the OnboardingStateView body', async () => {
    const r = await PATCH(req({ key: 'vertical_allowed', checked: true }), ctx())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toEqual(VIEW)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(updateChecklistItem).mockRejectedValueOnce(new Error('boom'))
    const r = await PATCH(req({ key: 'vertical_allowed', checked: true }), ctx())
    expect(r.status).toBe(500)
  })
})
