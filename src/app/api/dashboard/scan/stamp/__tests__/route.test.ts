import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/resolve-scan-identity')
vi.mock('@/application/apply-stamp-use-case')
vi.mock('@/infrastructure/supabase/repositories/stamp-campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/member-loyalty-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { resolveScanIdentity } from '@/application/resolve-scan-identity'
import { applyStampUseCase } from '@/application/apply-stamp-use-case'
import { findActiveStampCampaign } from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import { getMemberContact } from '@/infrastructure/supabase/repositories/member-loyalty-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { POST } from '../route'

const RESTAURANT_ID = 'rest-1'

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/scan/stamp', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function tenantOk() {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1',
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
}

function campaignOk() {
  vi.mocked(findActiveStampCampaign).mockResolvedValue({
    id: 'c-1',
    stampsRequired: 10,
    rewardId: 'rw-1',
    maxStampsPerDay: 1,
  })
}

describe('POST /api/dashboard/scan/stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMemberContact).mockResolvedValue({ phone: '85291234567', preferredLanguage: 'en' })
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
  })

  it('returns 401/403 when the tenant guard rejects', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden', 403))

    const res = await POST(req({ rawScan: 'X' }))

    expect(res.status).toBe(403)
  })

  it('returns not_resolved when the scan cannot resolve a member', async () => {
    tenantOk()
    vi.mocked(resolveScanIdentity).mockResolvedValue({ error: 'not_resolved' })

    const res = await POST(req({ rawScan: 'junk' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ error: 'not_resolved' })
    expect(applyStampUseCase).not.toHaveBeenCalled()
  })

  it('returns no_active_campaign (HTTP 200) when no campaign is running', async () => {
    tenantOk()
    vi.mocked(resolveScanIdentity).mockResolvedValue({ memberId: 'm-1' })
    vi.mocked(findActiveStampCampaign).mockResolvedValue(null)

    const res = await POST(req({ rawScan: 'LOYALTY:tok' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ error: 'no_active_campaign' })
    expect(applyStampUseCase).not.toHaveBeenCalled()
  })

  it('passes the resolved member + campaign cap to applyStampUseCase and maps the outcome', async () => {
    tenantOk()
    campaignOk()
    vi.mocked(resolveScanIdentity).mockResolvedValue({ memberId: 'm-1' })
    vi.mocked(applyStampUseCase).mockResolvedValue({
      outcome: 'stamped',
      stampsCount: 7,
      stampsRequired: 10,
      completed: false,
    })

    const res = await POST(req({ rawScan: 'LOYALTY:tok' }))
    const json = await res.json()

    expect(resolveScanIdentity).toHaveBeenCalledWith('LOYALTY:tok', RESTAURANT_ID)
    expect(applyStampUseCase).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        memberId: 'm-1',
        campaignId: 'c-1',
        actorUserId: 'u-1',
        maxPerDay: 1,
        phone: '85291234567',
        phoneNumberId: 'phone-id-1',
        language: 'en',
      })
    )
    expect(json).toEqual({
      outcome: 'stamped',
      stampsCount: 7,
      stampsRequired: 10,
      completed: false,
    })
  })

  it('returns 400 when rawScan is missing', async () => {
    tenantOk()

    const res = await POST(req({}))

    expect(res.status).toBe(400)
    expect(resolveScanIdentity).not.toHaveBeenCalled()
  })
})
