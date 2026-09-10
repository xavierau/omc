import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/configure-pos-integration')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { listIntegrations, createIntegration } from '@/application/configure-pos-integration'
import type { PosIntegration } from '@/domain/entities/pos-integration'
import { GET, POST } from '../route'

const ALLOWED_KEYS = [
  'id',
  'restaurantId',
  'provider',
  'name',
  'status',
  'fieldMapping',
  'secretLast4',
  'createdAt',
  'updatedAt',
].sort()

const INTEGRATION: PosIntegration = {
  id: 'int-1',
  restaurantId: 'rest-1',
  provider: 'ichef',
  name: 'My POS',
  status: 'active',
  webhookSecret: 'a'.repeat(60) + 'beef',
  fieldMapping: null,
  credentials: { apiKey: 'super-secret-api-key' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/pos-integrations', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'user-1',
    restaurantId: 'rest-1',
    role: 'staff',
    tenantStatus: 'active',
  } as never)
})

describe('GET /api/dashboard/pos-integrations', () => {
  it('never leaks webhookSecret or credentials — projection allowlist only', async () => {
    vi.mocked(listIntegrations).mockResolvedValue([INTEGRATION])

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(1)
    expect(Object.keys(json.data[0]).sort()).toEqual(ALLOWED_KEYS)
    expect(JSON.stringify(json)).not.toContain('super-secret-api-key')
    expect(JSON.stringify(json)).not.toContain(INTEGRATION.webhookSecret)
  })

  it('exposes only secretLast4', async () => {
    vi.mocked(listIntegrations).mockResolvedValue([INTEGRATION])

    const res = await GET()
    const json = await res.json()

    expect(json.data[0].secretLast4).toBe('beef')
  })
})

describe('POST /api/dashboard/pos-integrations', () => {
  it('creates and returns the one-time webhook secret at creation', async () => {
    vi.mocked(createIntegration).mockResolvedValue({
      id: 'int-1',
      webhookUrl: 'https://app.example.com/api/webhooks/pos/int-1',
      webhookSecret: 'brand-new-secret',
    })

    const res = await POST(postReq({ name: 'My POS' }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.data.webhookSecret).toBe('brand-new-secret')
  })
})
