import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/configure-pos-integration')
vi.mock('@/application/send-test-event')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getIntegration } from '@/application/configure-pos-integration'
import { sendTestEvent } from '@/application/send-test-event'
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

function ctxParams() {
  return { params: Promise.resolve({ id: 'int-1' }) }
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

describe('POST .../outbound/test', () => {
  it('rejects staff with 403', async () => {
    mockRole('staff')
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(403)
    expect(sendTestEvent).not.toHaveBeenCalled()
  })

  it('404s for a foreign-tenant id', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(404)
    expect(sendTestEvent).not.toHaveBeenCalled()
  })

  it('returns 202 with the deliveryId on success', async () => {
    vi.mocked(sendTestEvent).mockResolvedValue({ ok: true, deliveryId: 'del-99' })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    const json = await res.json()
    expect(res.status).toBe(202)
    expect(json.deliveryId).toBe('del-99')
  })

  it('returns 422 url_not_saved when no URL has been saved', async () => {
    vi.mocked(sendTestEvent).mockResolvedValue({ ok: false, error: 'url_not_saved' })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.error).toBe('url_not_saved')
  })

  it('surfaces not_eligible_for_delivery as its own 422 code (URL saved but outbound not enabled/acked)', async () => {
    vi.mocked(sendTestEvent).mockResolvedValue({ ok: false, error: 'not_eligible_for_delivery' })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.error).toBe('not_eligible_for_delivery')
  })
})
