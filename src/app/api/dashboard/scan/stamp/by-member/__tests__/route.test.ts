import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/apply-stamp-use-case')
vi.mock('@/infrastructure/supabase/repositories/stamp-campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/member-loyalty-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { applyStampUseCase } from '@/application/apply-stamp-use-case'
import { findStampableCampaignForMember } from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import { getMemberContact } from '@/infrastructure/supabase/repositories/member-loyalty-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { POST } from '../route'

const RESTAURANT_ID = 'rest-1'

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/scan/stamp/by-member', {
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

describe('POST /api/dashboard/scan/stamp/by-member', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMemberContact).mockResolvedValue({ phone: '85291234567', preferredLanguage: 'en' })
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
  })

  it('rejects when the tenant guard rejects', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden', 403))
    const res = await POST(req({ memberId: 'm-1' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when memberId is missing', async () => {
    tenantOk()
    const res = await POST(req({}))
    expect(res.status).toBe(400)
    expect(applyStampUseCase).not.toHaveBeenCalled()
  })

  it('returns no_active_campaign (HTTP 200) when no campaign is running', async () => {
    tenantOk()
    vi.mocked(findStampableCampaignForMember).mockResolvedValue(null)
    const res = await POST(req({ memberId: 'm-1' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({ error: 'no_active_campaign' })
    expect(applyStampUseCase).not.toHaveBeenCalled()
  })

  it('stamps the looked-up member and maps the outcome', async () => {
    tenantOk()
    vi.mocked(findStampableCampaignForMember).mockResolvedValue({
      id: 'c-1', stampsRequired: 10, rewardId: 'rw-1', maxStampsPerDay: 1,
    })
    vi.mocked(applyStampUseCase).mockResolvedValue({
      outcome: 'stamped', stampsCount: 4, stampsRequired: 10, completed: false,
    })
    const res = await POST(req({ memberId: 'm-1' }))
    const json = await res.json()
    expect(findStampableCampaignForMember).toHaveBeenCalledWith(RESTAURANT_ID, 'm-1')
    expect(applyStampUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm-1', campaignId: 'c-1', actorUserId: 'u-1' })
    )
    expect(json).toEqual({
      outcome: 'stamped', stampsCount: 4, stampsRequired: 10, completed: false,
    })
  })
})
