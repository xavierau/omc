import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/application/onboarding/get-onboarding-state', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/onboarding/get-onboarding-state')
  >('@/application/onboarding/get-onboarding-state')
  return { ...actual, getOnboardingState: vi.fn() }
})

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import {
  getOnboardingState,
  type OnboardingStateView,
} from '@/application/onboarding/get-onboarding-state'
import { GET } from '../route'

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const BAD_ID = 'not-a-uuid'

const VIEW: OnboardingStateView = {
  restaurantId: TENANT_ID,
  path: null,
  phase: 'setup',
  checklist: {
    hk_sim_never_used: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
    verified_meta_business: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
    display_name_draft_approved: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
    opt_in_source_documented: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
    vertical_allowed: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
    first_three_campaigns_drafted: { checked: false, status: 'pending', checkedAt: null, checkedBy: null },
  },
  kpiGate: { status: 'insufficient', observed: 12, required: 100 },
  checklistComplete: false,
  nextPhase: 'probe',
  canAdvance: false,
  blockedReasons: ['no_path', 'checklist_incomplete', 'kpi_insufficient'],
}

function req(): NextRequest {
  return new NextRequest(`http://localhost/api/admin/tenants/${TENANT_ID}/onboarding`)
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
  vi.mocked(getOnboardingState).mockResolvedValue(VIEW)
})

describe('GET /api/admin/tenants/[id]/onboarding', () => {
  it('returns 401 when not signed in', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await GET(req(), ctx(TENANT_ID))
    expect(r.status).toBe(401)
  })

  it('returns 403 when not a platform admin', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(new AuthError('Forbidden', 403))
    const r = await GET(req(), ctx(TENANT_ID))
    expect(r.status).toBe(403)
  })

  it('returns 429 when rate-limited', async () => {
    vi.mocked(checkAdminRateLimit).mockReturnValueOnce({ success: false, remaining: 0 })
    const r = await GET(req(), ctx(TENANT_ID))
    expect(r.status).toBe(429)
  })

  it('returns 400 for an invalid tenant UUID', async () => {
    const r = await GET(req(), ctx(BAD_ID))
    expect(r.status).toBe(400)
    expect(getOnboardingState).not.toHaveBeenCalled()
  })

  it('returns the OnboardingStateView with status 200', async () => {
    const r = await GET(req(), ctx(TENANT_ID))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toEqual(VIEW)
    expect(getOnboardingState).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: TENANT_ID })
    )
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getOnboardingState).mockRejectedValueOnce(new Error('boom'))
    const r = await GET(req(), ctx(TENANT_ID))
    expect(r.status).toBe(500)
  })
})
