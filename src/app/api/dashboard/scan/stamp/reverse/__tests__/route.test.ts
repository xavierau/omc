import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/reverse-stamp-use-case')
vi.mock('@/infrastructure/supabase/repositories/stamp-campaign-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { reverseStampUseCase } from '@/application/reverse-stamp-use-case'
import { findActiveStampCampaign } from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import { POST } from '../route'

const RESTAURANT_ID = 'rest-1'

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/scan/stamp/reverse', {
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

describe('POST /api/dashboard/scan/stamp/reverse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findActiveStampCampaign).mockResolvedValue({
      id: 'c-1',
      stampsRequired: 10,
      rewardId: 'rw-1',
      maxStampsPerDay: 1,
    })
  })

  it('rejects an unauthenticated caller', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden', 403))

    const res = await POST(req({ memberId: 'm-1' }))

    expect(res.status).toBe(403)
  })

  it('returns 400 when memberId is missing', async () => {
    tenantOk()

    const res = await POST(req({}))

    expect(res.status).toBe(400)
    expect(reverseStampUseCase).not.toHaveBeenCalled()
  })

  it('returns no_active_campaign when none is running', async () => {
    tenantOk()
    vi.mocked(findActiveStampCampaign).mockResolvedValue(null)

    const res = await POST(req({ memberId: 'm-1' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ error: 'no_active_campaign' })
  })

  it('reverses a stamp with the actor captured and maps the outcome', async () => {
    tenantOk()
    vi.mocked(reverseStampUseCase).mockResolvedValue({
      outcome: 'reversed',
      stampsCount: 6,
      stampsRequired: 10,
    })

    const res = await POST(req({ memberId: 'm-1' }))
    const json = await res.json()

    expect(reverseStampUseCase).toHaveBeenCalledWith({
      restaurantId: RESTAURANT_ID,
      memberId: 'm-1',
      campaignId: 'c-1',
      actorUserId: 'u-1',
    })
    expect(json).toEqual({ outcome: 'reversed', stampsCount: 6, stampsRequired: 10 })
  })

  it('maps an at_zero no-op', async () => {
    tenantOk()
    vi.mocked(reverseStampUseCase).mockResolvedValue({
      outcome: 'at_zero',
      stampsCount: 0,
      stampsRequired: 10,
    })

    const res = await POST(req({ memberId: 'm-1' }))
    const json = await res.json()

    expect(json).toEqual({ outcome: 'at_zero', stampsCount: 0, stampsRequired: 10 })
  })
})
