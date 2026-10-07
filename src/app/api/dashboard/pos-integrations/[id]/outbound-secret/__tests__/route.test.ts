import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/configure-pos-integration')
vi.mock('@/application/set-outbound-secret')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getIntegration } from '@/application/configure-pos-integration'
import { setOutboundSecret } from '@/application/set-outbound-secret'
import type { PosIntegration } from '@/domain/entities/pos-integration'
import { PUT } from '../route'

const INTEGRATION: PosIntegration = {
  id: 'int-1',
  restaurantId: 'rest-1',
  provider: 'ichef',
  name: 'My POS',
  status: 'active',
  webhookSecret: 'x'.repeat(64),
  fieldMapping: null,
  credentials: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function ctxParams() {
  return { params: Promise.resolve({ id: 'int-1' }) }
}

function putReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/x', { method: 'PUT', body: JSON.stringify(body) })
}

function mockRole(role: 'admin' | 'staff') {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'user-1',
    restaurantId: 'rest-1',
    role,
    tenantStatus: 'active',
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockRole('admin')
  vi.mocked(getIntegration).mockResolvedValue(INTEGRATION)
})

describe('PUT /api/dashboard/pos-integrations/[id]/outbound-secret', () => {
  it('rejects staff with 403', async () => {
    mockRole('staff')
    const res = await PUT(putReq({ secret: 'a'.repeat(20) }), ctxParams())
    expect(res.status).toBe(403)
    expect(setOutboundSecret).not.toHaveBeenCalled()
  })

  it('404s for a foreign-tenant id', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)
    const res = await PUT(putReq({ secret: 'a'.repeat(20) }), ctxParams())
    expect(res.status).toBe(404)
    expect(setOutboundSecret).not.toHaveBeenCalled()
  })

  it('returns 422 secret_too_short and never echoes the value', async () => {
    vi.mocked(setOutboundSecret).mockResolvedValue({ ok: false, error: 'secret_too_short' })

    const res = await PUT(putReq({ secret: 'short' }), ctxParams())
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error).toBe('secret_too_short')
    expect(JSON.stringify(json)).not.toContain('"short"')
  })

  it('returns only last4 + updatedAt on success, never the plaintext', async () => {
    vi.mocked(setOutboundSecret).mockResolvedValue({ ok: true, last4: 'z9y8', updatedAt: '2026-09-10T00:00:00Z' })

    const res = await PUT(putReq({ secret: 'a-partner-minted-secret' }), ctxParams())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ last4: 'z9y8', updatedAt: '2026-09-10T00:00:00Z' })
    expect(JSON.stringify(json)).not.toContain('a-partner-minted-secret')
  })
})
