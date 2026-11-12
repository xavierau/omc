import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/stamp-campaign-repository')
vi.mock('@/application/create-stamp-campaign-use-case', async () => {
  // Keep the real error classes so their `.message` survives for route mapping.
  const actual = await vi.importActual<
    typeof import('@/application/create-stamp-campaign-use-case')
  >('@/application/create-stamp-campaign-use-case')
  return { ...actual, createStampCampaignUseCase: vi.fn() }
})
vi.mock('@/application/transition-stamp-campaign-use-case', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/transition-stamp-campaign-use-case')
  >('@/application/transition-stamp-campaign-use-case')
  return { ...actual, transitionStampCampaignUseCase: vi.fn() }
})

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { listStampCampaigns } from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import {
  createStampCampaignUseCase,
  NoRewardsError,
  RewardNotFoundError,
  CapBlockedError,
} from '@/application/create-stamp-campaign-use-case'
import {
  transitionStampCampaignUseCase,
  OneActiveCampaignError,
  StampCampaignNotFoundError,
} from '@/application/transition-stamp-campaign-use-case'
import { GET, POST, PATCH } from '../route'

const REST = 'r-1'

function req(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/campaigns/stamps', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function tenantOk() {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1', restaurantId: REST, role: 'admin', tenantStatus: 'active',
  })
}

const VIEW = {
  id: 'c-1', restaurantId: REST, name: 'Coffee', nameZh: null,
  stampsRequired: 10, rewardId: 'rw-1', status: 'draft' as const,
  maxStampsPerDay: 1, honorUntil: null,
}

describe('GET /api/dashboard/campaigns/stamps', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the tenant campaigns', async () => {
    tenantOk()
    vi.mocked(listStampCampaigns).mockResolvedValue([VIEW])
    const res = await GET()
    expect(await res.json()).toEqual({ campaigns: [VIEW] })
  })

  it('propagates the tenant-guard rejection status', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden', 403))
    const res = await GET()
    expect(res.status).toBe(403)
  })
})

describe('POST /api/dashboard/campaigns/stamps (create)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a draft and echoes any cap warning', async () => {
    tenantOk()
    vi.mocked(createStampCampaignUseCase).mockResolvedValue({
      campaign: VIEW, warning: 'risk',
    })
    const res = await POST(req({ name: 'Coffee', stampsRequired: 10, rewardId: 'rw-1' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ campaign: VIEW, warning: 'risk' })
    expect(createStampCampaignUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: REST, rewardId: 'rw-1', stampsRequired: 10 })
    )
  })

  it('400 when required fields are missing', async () => {
    tenantOk()
    const res = await POST(req({ name: 'Coffee' }))
    expect(res.status).toBe(400)
    expect(createStampCampaignUseCase).not.toHaveBeenCalled()
  })

  it('409 with a clear message when the restaurant has zero rewards', async () => {
    tenantOk()
    vi.mocked(createStampCampaignUseCase).mockRejectedValue(new NoRewardsError())
    const res = await POST(req({ name: 'Coffee', stampsRequired: 10, rewardId: 'rw-1' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('reward')
  })

  it('400 when the reward does not belong to the tenant', async () => {
    tenantOk()
    vi.mocked(createStampCampaignUseCase).mockRejectedValue(new RewardNotFoundError())
    const res = await POST(req({ name: 'Coffee', stampsRequired: 10, rewardId: 'rw-x' }))
    expect(res.status).toBe(400)
  })

  it('422 when the cap policy blocks the chosen max_stamps_per_day', async () => {
    tenantOk()
    vi.mocked(createStampCampaignUseCase).mockRejectedValue(
      new CapBlockedError('Your plan limits stamps to 1/day.')
    )
    const res = await POST(req({ name: 'C', stampsRequired: 10, rewardId: 'rw-1', maxStampsPerDay: 3 }))
    expect(res.status).toBe(422)
  })
})

describe('PATCH /api/dashboard/campaigns/stamps (transition)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('activates and returns the updated campaign', async () => {
    tenantOk()
    vi.mocked(transitionStampCampaignUseCase).mockResolvedValue({ ...VIEW, status: 'active' })
    const res = await PATCH(req({ id: 'c-1', action: 'activate' }))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('active')
    expect(transitionStampCampaignUseCase).toHaveBeenCalledWith({
      id: 'c-1', restaurantId: REST, action: 'activate',
    })
  })

  it('400 on an unknown action', async () => {
    tenantOk()
    const res = await PATCH(req({ id: 'c-1', action: 'delete' }))
    expect(res.status).toBe(400)
    expect(transitionStampCampaignUseCase).not.toHaveBeenCalled()
  })

  it('409 "Pause the running card first." on the one-active conflict', async () => {
    tenantOk()
    vi.mocked(transitionStampCampaignUseCase).mockRejectedValue(new OneActiveCampaignError())
    const res = await PATCH(req({ id: 'c-1', action: 'activate' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Pause the running card first.')
  })

  it('404 when the campaign is not in the tenant', async () => {
    tenantOk()
    vi.mocked(transitionStampCampaignUseCase).mockRejectedValue(new StampCampaignNotFoundError())
    const res = await PATCH(req({ id: 'c-x', action: 'pause' }))
    expect(res.status).toBe(404)
  })
})
