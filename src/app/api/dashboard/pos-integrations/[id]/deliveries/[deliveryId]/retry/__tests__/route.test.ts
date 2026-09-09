import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/configure-pos-integration')
vi.mock('@/application/retry-delivery')
vi.mock('@/infrastructure/supabase/repositories/integration-delivery-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getIntegration } from '@/application/configure-pos-integration'
import { retryDelivery } from '@/application/retry-delivery'
import { findDeliveryById } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import type { PosIntegration } from '@/domain/entities/pos-integration'
import { POST } from '../route'

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

function ctxParams(deliveryId = 'del-1') {
  return { params: Promise.resolve({ id: 'int-1', deliveryId }) }
}

function mockRole(role: 'admin' | 'staff') {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'user-1',
    restaurantId: 'rest-1',
    role,
    tenantStatus: 'active',
  } as never)
}

function deliveryFor(integrationId: string, restaurantId: string) {
  return { snapshot: { id: 'del-1', integrationId, restaurantId, status: 'dead_lettered' } } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockRole('admin')
  vi.mocked(getIntegration).mockResolvedValue(INTEGRATION)
  vi.mocked(findDeliveryById).mockResolvedValue(deliveryFor('int-1', 'rest-1'))
})

describe('POST .../deliveries/[deliveryId]/retry', () => {
  it('rejects staff with 403', async () => {
    mockRole('staff')
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(403)
    expect(retryDelivery).not.toHaveBeenCalled()
  })

  it('404s for a foreign-tenant integration id', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(404)
    expect(retryDelivery).not.toHaveBeenCalled()
  })

  it('404s when the deliveryId belongs to a different integration (IDOR guard)', async () => {
    vi.mocked(findDeliveryById).mockResolvedValue(deliveryFor('int-OTHER', 'rest-1'))
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(404)
    expect(retryDelivery).not.toHaveBeenCalled()
  })

  it('404s when the deliveryId belongs to a different tenant even under the same integration id string', async () => {
    vi.mocked(findDeliveryById).mockResolvedValue(deliveryFor('int-1', 'rest-OTHER'))
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(404)
    expect(retryDelivery).not.toHaveBeenCalled()
  })

  it('404s when the delivery does not exist at all', async () => {
    vi.mocked(findDeliveryById).mockResolvedValue(null)
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(404)
    expect(retryDelivery).not.toHaveBeenCalled()
  })

  it('returns 202 on success', async () => {
    vi.mocked(retryDelivery).mockResolvedValue({ ok: true })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(202)
    expect(retryDelivery).toHaveBeenCalledWith('del-1')
  })

  it('returns 409 already_retried on a second retry', async () => {
    vi.mocked(retryDelivery).mockResolvedValue({ ok: false, error: 'already_retried' })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.error).toBe('already_retried')
  })

  it('returns 404 when the delivery is not dead-lettered', async () => {
    vi.mocked(retryDelivery).mockResolvedValue({ ok: false, error: 'not_dead_lettered' })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(404)
  })
})
