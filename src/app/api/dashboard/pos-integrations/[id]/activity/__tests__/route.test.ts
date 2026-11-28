import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/configure-pos-integration')
vi.mock('@/application/list-integration-activity')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getIntegration } from '@/application/configure-pos-integration'
import { listIntegrationActivity } from '@/application/list-integration-activity'
import type { PosIntegration } from '@/domain/entities/pos-integration'
import { GET } from '../route'

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
  vi.mocked(listIntegrationActivity).mockResolvedValue({ data: [], nextCursor: null })
})

describe('GET .../activity', () => {
  it('rejects staff with 403', async () => {
    mockRole('staff')
    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())
    expect(res.status).toBe(403)
    expect(listIntegrationActivity).not.toHaveBeenCalled()
  })

  it('404s for a foreign-tenant id', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())
    expect(res.status).toBe(404)
  })

  it('forwards cursor and scopes by both integration and restaurant', async () => {
    await GET(new NextRequest('http://localhost/x?cursor=2026-09-10T00:00:00Z'), ctxParams())
    expect(listIntegrationActivity).toHaveBeenCalledWith('int-1', 'rest-1', { cursor: '2026-09-10T00:00:00Z' })
  })

  it('rows never carry a full phone number, only phone_last4', async () => {
    vi.mocked(listIntegrationActivity).mockResolvedValue({
      data: [
        {
          jobId: 'job-1',
          status: 'succeeded',
          outcome: 'created',
          assertedLevel: 'all',
          consentActions: {},
          welcomeOutcome: 'queued',
          welcomeDetail: null,
          phoneLast4: '5432',
          submittedAt: '2026-09-10T00:00:00Z',
        },
      ],
      nextCursor: null,
    })

    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(JSON.stringify(json)).not.toMatch(/\+?\d{8,}/)
    expect(json.data[0].phoneLast4).toBe('5432')
  })
})
