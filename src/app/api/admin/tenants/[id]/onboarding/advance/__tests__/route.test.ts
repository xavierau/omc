import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/infrastructure/supabase/audit-logger', () => ({
  logAdminAction: vi.fn(),
  extractIp: vi.fn().mockReturnValue('1.2.3.4'),
}))
vi.mock('@/application/onboarding/advance-phase', () => ({
  advancePhase: vi.fn(),
}))
vi.mock('@/application/onboarding/get-onboarding-state', () => ({
  getOnboardingState: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/event-repository', () => ({
  createEvent: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { logAdminAction } from '@/infrastructure/supabase/audit-logger'
import { advancePhase } from '@/application/onboarding/advance-phase'
import { getOnboardingState } from '@/application/onboarding/get-onboarding-state'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import {
  ConcurrentAdvanceError,
  OnboardingAdvanceError,
} from '@/domain/services/__errors__/onboarding-errors'
import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import { POST } from '../route'

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const VIEW = { restaurantId: TENANT_ID } as never

const PASS_GATE = {
  status: 'pass' as const,
  kpis: {
    totalSends: 200,
    delivered: 195,
    read: 100,
    failed: 5,
    optedOut: 1,
    deliveryRate: 0.975,
    readRate: 0.5,
    errorRate: 0.025,
    optOutRate: 0.005,
  },
  thresholds: {
    minDeliveryRate: 0.95,
    maxOptOutRate: 0.02,
    minSampleSize: 100,
    windowDays: 7,
  },
  failingMetrics: [],
}

function req(): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/tenants/${TENANT_ID}/onboarding/advance`,
    { method: 'POST' }
  )
}

function ctx(id: string = TENANT_ID) {
  return { params: Promise.resolve({ id }) }
}

function makeAdvancedState() {
  const base = TenantOnboardingState.createDefault({
    id: 'id-1',
    restaurantId: TENANT_ID,
    now: '2026-05-05T00:00:00.000Z',
  })
  return TenantOnboardingState.fromProps({
    ...base.snapshot,
    onboardingPath: 'A',
    phase: 'probe',
    advancedAt: '2026-05-05T01:00:00.000Z',
    advancedBy: 'admin-1',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
  vi.mocked(advancePhase).mockResolvedValue({
    state: makeAdvancedState(),
    fromPhase: 'setup',
    toPhase: 'probe',
    kpiGate: PASS_GATE,
  })
  vi.mocked(getOnboardingState).mockResolvedValue(VIEW)
  vi.mocked(createEvent).mockResolvedValue('evt-1')
})

describe('POST /api/admin/tenants/[id]/onboarding/advance', () => {
  it('returns 401 when not signed in', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await POST(req(), ctx())
    expect(r.status).toBe(401)
  })

  it('returns 429 when rate-limited', async () => {
    vi.mocked(checkAdminRateLimit).mockReturnValueOnce({ success: false, remaining: 0 })
    const r = await POST(req(), ctx())
    expect(r.status).toBe(429)
  })

  it('returns 400 for invalid tenant UUID', async () => {
    const r = await POST(req(), ctx('bad'))
    expect(r.status).toBe(400)
  })

  it('returns 200 with the OnboardingStateView body on success', async () => {
    const r = await POST(req(), ctx())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toEqual(VIEW)
  })

  it('writes onboarding.phase.advance audit log on success', async () => {
    await POST(req(), ctx())
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'onboarding.phase.advance',
        resourceType: 'tenant',
        resourceId: TENANT_ID,
        details: expect.objectContaining({
          from: 'setup',
          to: 'probe',
          kpiGate: 'pass',
        }),
      })
    )
  })

  it('emits an onboarding_phase_advanced event on success (best-effort)', async () => {
    await POST(req(), ctx())
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: TENANT_ID,
        type: 'onboarding_phase_advanced',
        dataJson: expect.objectContaining({ from: 'setup', to: 'probe' }),
      })
    )
  })

  it('still returns 200 if event emission fails', async () => {
    vi.mocked(createEvent).mockRejectedValueOnce(new Error('events down'))
    const r = await POST(req(), ctx())
    expect(r.status).toBe(200)
  })

  it('passes the auth user id as the actor to advancePhase', async () => {
    await POST(req(), ctx())
    expect(advancePhase).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'admin-1', restaurantId: TENANT_ID })
    )
  })

  it('maps OnboardingAdvanceError(checklist_incomplete) to 409', async () => {
    vi.mocked(advancePhase).mockRejectedValueOnce(
      new OnboardingAdvanceError('checklist_incomplete')
    )
    const r = await POST(req(), ctx())
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.reason).toBe('checklist_incomplete')
  })

  it('maps OnboardingAdvanceError(kpi_failed) to 409', async () => {
    vi.mocked(advancePhase).mockRejectedValueOnce(new OnboardingAdvanceError('kpi_failed'))
    const r = await POST(req(), ctx())
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.reason).toBe('kpi_failed')
  })

  it('maps OnboardingAdvanceError(kpi_insufficient) to 409', async () => {
    vi.mocked(advancePhase).mockRejectedValueOnce(
      new OnboardingAdvanceError('kpi_insufficient')
    )
    const r = await POST(req(), ctx())
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.reason).toBe('kpi_insufficient')
  })

  it('maps ConcurrentAdvanceError to 409 with reason=concurrent_advance', async () => {
    vi.mocked(advancePhase).mockRejectedValueOnce(new ConcurrentAdvanceError())
    const r = await POST(req(), ctx())
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.reason).toBe('concurrent_advance')
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(advancePhase).mockRejectedValueOnce(new Error('boom'))
    const r = await POST(req(), ctx())
    expect(r.status).toBe(500)
  })
})
