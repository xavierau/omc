import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/configure-pos-integration')
vi.mock('@/application/resume-outbound')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getIntegration } from '@/application/configure-pos-integration'
import { resumeOutbound } from '@/application/resume-outbound'
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

describe('POST .../outbound/resume', () => {
  it('rejects staff with 403', async () => {
    mockRole('staff')
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(403)
    expect(resumeOutbound).not.toHaveBeenCalled()
  })

  it('404s for a foreign-tenant id', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    expect(res.status).toBe(404)
    expect(resumeOutbound).not.toHaveBeenCalled()
  })

  it('returns 200 with requeued count on success', async () => {
    vi.mocked(resumeOutbound).mockResolvedValue({ ok: true, requeued: 37, deadLettered: 2 })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.requeued).toBe(37)
    expect(resumeOutbound).toHaveBeenCalledWith('int-1', 'rest-1')
  })

  it('returns 422 url_invalid when the URL cannot support a resume', async () => {
    vi.mocked(resumeOutbound).mockResolvedValue({ ok: false, error: 'url_invalid' })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctxParams())
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.error).toBe('url_invalid')
  })
})
