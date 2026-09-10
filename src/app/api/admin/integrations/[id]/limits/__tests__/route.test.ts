// INT-001 WI-2: PATCH /api/admin/integrations/[id]/limits -- platform-admin
// override of per-integration rate/queue-cap settings (spec US-5: "default
// 60 req/min, burst 20 ... configurable per integration by platform admin,
// not by owner"). Mirrors the auth/rate-limit/validation posture of
// /api/admin/tenants/[id]/campaign-settings (PUT).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/application/update-integration-inbound-limits', () => ({
  updateIntegrationInboundLimits: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { updateIntegrationInboundLimits } from '@/application/update-integration-inbound-limits'
import { PATCH } from '../route'

const VALID_ID = '11111111-1111-1111-1111-111111111111'

function req(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/admin/integrations/${VALID_ID}/limits`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function params(id: string = VALID_ID) {
  return { params: Promise.resolve({ id }) }
}

function settingsSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    snapshot: {
      integrationId: VALID_ID,
      inboundRatePerMin: 60,
      inboundBurst: 20,
      inboundQueueCap: 500,
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
})

describe('PATCH /api/admin/integrations/[id]/limits', () => {
  it('returns 401 when the caller is not signed in', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await PATCH(req({ inboundRatePerMin: 100 }), params())
    expect(r.status).toBe(401)
  })

  it('returns 403 when the caller is not a platform admin', async () => {
    vi.mocked(assertPlatformAdmin).mockRejectedValueOnce(new AuthError('Forbidden: not a platform admin', 403))
    const r = await PATCH(req({ inboundRatePerMin: 100 }), params())
    expect(r.status).toBe(403)
  })

  it('returns 429 when the per-admin rate limit is exhausted', async () => {
    vi.mocked(checkAdminRateLimit).mockReturnValueOnce({ success: false, remaining: 0 })
    const r = await PATCH(req({ inboundRatePerMin: 100 }), params())
    expect(r.status).toBe(429)
  })

  it('returns 400 for a malformed integration id', async () => {
    const r = await PATCH(req({ inboundRatePerMin: 100 }), params('not-a-uuid'))
    expect(r.status).toBe(400)
  })

  it.each([
    ['inboundRatePerMin too low', { inboundRatePerMin: 0 }],
    ['inboundRatePerMin too high', { inboundRatePerMin: 6001 }],
    ['inboundRatePerMin non-integer', { inboundRatePerMin: 1.5 }],
    ['inboundBurst too low', { inboundBurst: 0 }],
    ['inboundBurst too high', { inboundBurst: 1001 }],
    ['inboundQueueCap too low', { inboundQueueCap: 0 }],
    ['inboundQueueCap too high', { inboundQueueCap: 100001 }],
    ['wrong type', { inboundRatePerMin: '100' }],
  ])('returns 400 for %s', async (_label, body) => {
    const r = await PATCH(req(body), params())
    expect(r.status).toBe(400)
    expect(updateIntegrationInboundLimits).not.toHaveBeenCalled()
  })

  it('returns 400 when the body has none of the three known fields', async () => {
    const r = await PATCH(req({}), params())
    expect(r.status).toBe(400)
  })

  it('returns 404 when the integration has no settings row', async () => {
    vi.mocked(updateIntegrationInboundLimits).mockResolvedValueOnce(null)
    const r = await PATCH(req({ inboundRatePerMin: 100 }), params())
    expect(r.status).toBe(404)
  })

  it('applies a partial update and returns the resulting limits', async () => {
    vi.mocked(updateIntegrationInboundLimits).mockResolvedValueOnce(settingsSnapshot({ inboundRatePerMin: 120 }) as never)
    const r = await PATCH(req({ inboundRatePerMin: 120 }), params())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toEqual({ inboundRatePerMin: 120, inboundBurst: 20, inboundQueueCap: 500 })
    expect(updateIntegrationInboundLimits).toHaveBeenCalledWith(VALID_ID, { inboundRatePerMin: 120 })
  })

  it('accepts all three fields at once', async () => {
    vi.mocked(updateIntegrationInboundLimits).mockResolvedValueOnce(
      settingsSnapshot({ inboundRatePerMin: 200, inboundBurst: 40, inboundQueueCap: 1000 }) as never
    )
    const r = await PATCH(req({ inboundRatePerMin: 200, inboundBurst: 40, inboundQueueCap: 1000 }), params())
    expect(r.status).toBe(200)
    expect(updateIntegrationInboundLimits).toHaveBeenCalledWith(VALID_ID, {
      inboundRatePerMin: 200,
      inboundBurst: 40,
      inboundQueueCap: 1000,
    })
  })
})
