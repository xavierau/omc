import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/configure-pos-integration')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getIntegration, rotateInboundSecret } from '@/application/configure-pos-integration'
import type { PosIntegration } from '@/domain/entities/pos-integration'
import { POST } from '../route'

const INTEGRATION: PosIntegration = {
  id: 'int-1',
  restaurantId: 'rest-1',
  provider: 'ichef',
  name: 'My POS',
  status: 'active',
  webhookSecret: 'old-secret-a'.repeat(5),
  fieldMapping: null,
  credentials: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function ctxParams() {
  return { params: Promise.resolve({ id: 'int-1' }) }
}

function req(): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/pos-integrations/int-1/rotate-inbound-secret', {
    method: 'POST',
  })
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
})

describe('POST /api/dashboard/pos-integrations/[id]/rotate-inbound-secret', () => {
  it('rejects staff with 403 and never rotates', async () => {
    mockRole('staff')

    const res = await POST(req(), ctxParams())

    expect(res.status).toBe(403)
    expect(rotateInboundSecret).not.toHaveBeenCalled()
  })

  it('mints and returns a new 64-hex secret once for admin', async () => {
    vi.mocked(getIntegration).mockResolvedValue(INTEGRATION)
    vi.mocked(rotateInboundSecret).mockResolvedValue('f'.repeat(64))

    const res = await POST(req(), ctxParams())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.webhookSecret).toBe('f'.repeat(64))
    expect(rotateInboundSecret).toHaveBeenCalledWith('int-1', 'user-1')
  })

  it('404s for a foreign-tenant id via the scoped query, before rotating', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)

    const res = await POST(req(), ctxParams())

    expect(res.status).toBe(404)
    expect(rotateInboundSecret).not.toHaveBeenCalled()
  })
})
