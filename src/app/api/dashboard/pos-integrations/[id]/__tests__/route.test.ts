import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/configure-pos-integration')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getIntegration, updateIntegration, deleteIntegration } from '@/application/configure-pos-integration'
import type { PosIntegration } from '@/domain/entities/pos-integration'
import { GET, PATCH, DELETE } from '../route'

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

function ctxParams() {
  return { params: Promise.resolve({ id: 'int-1' }) }
}

function patchReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/pos-integrations/int-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
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

describe('GET /api/dashboard/pos-integrations/[id]', () => {
  it('looks up scoped by (id, restaurantId) and returns the public projection only', async () => {
    vi.mocked(getIntegration).mockResolvedValue(INTEGRATION)

    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())
    const json = await res.json()

    expect(getIntegration).toHaveBeenCalledWith('int-1', 'rest-1')
    expect(res.status).toBe(200)
    expect(Object.keys(json.data).sort()).toEqual(ALLOWED_KEYS)
    expect(JSON.stringify(json)).not.toContain('super-secret-api-key')
    expect(JSON.stringify(json)).not.toContain(INTEGRATION.webhookSecret)
  })

  it('404s for an id the scoped query does not find (foreign tenant or unknown)', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)

    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())

    expect(res.status).toBe(404)
  })

  it('does not require admin role — staff can read', async () => {
    mockRole('staff')
    vi.mocked(getIntegration).mockResolvedValue(INTEGRATION)

    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())

    expect(res.status).toBe(200)
  })
})

describe('PATCH /api/dashboard/pos-integrations/[id]', () => {
  it('rejects staff with 403 and never touches the row', async () => {
    mockRole('staff')

    const res = await PATCH(patchReq({ name: 'New Name' }), ctxParams())

    expect(res.status).toBe(403)
    expect(getIntegration).not.toHaveBeenCalled()
    expect(updateIntegration).not.toHaveBeenCalled()
  })

  it('allows admin to patch an allowlisted field', async () => {
    vi.mocked(getIntegration).mockResolvedValue(INTEGRATION)
    vi.mocked(updateIntegration).mockResolvedValue(undefined)

    const res = await PATCH(patchReq({ name: 'New Name' }), ctxParams())

    expect(res.status).toBe(200)
    expect(updateIntegration).toHaveBeenCalledWith('int-1', 'rest-1', { name: 'New Name' })
  })

  it.each([
    ['webhookSecret', { webhookSecret: 'attacker-chosen-secret' }],
    ['outboundUrl', { outboundUrl: 'https://evil.example.com' }],
    ['restaurantId', { restaurantId: 'some-other-tenant' }],
    ['compound webhookSecret + status', { status: 'active', webhookSecret: 'attacker-chosen-secret' }],
  ])('rejects a PATCH containing %s with 400 unknown_field and leaves the row unchanged', async (_label, body) => {
    vi.mocked(getIntegration).mockResolvedValue(INTEGRATION)

    const res = await PATCH(patchReq(body), ctxParams())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('unknown_field')
    expect(updateIntegration).not.toHaveBeenCalled()
  })

  it('404s for a foreign-tenant id via the scoped query, before any write', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)

    const res = await PATCH(patchReq({ name: 'New Name' }), ctxParams())

    expect(res.status).toBe(404)
    expect(updateIntegration).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/dashboard/pos-integrations/[id]', () => {
  it('rejects staff with 403', async () => {
    mockRole('staff')

    const res = await DELETE(new NextRequest('http://localhost/x'), ctxParams())

    expect(res.status).toBe(403)
    expect(deleteIntegration).not.toHaveBeenCalled()
  })

  it('allows admin to delete', async () => {
    vi.mocked(getIntegration).mockResolvedValue(INTEGRATION)
    vi.mocked(deleteIntegration).mockResolvedValue(undefined)

    const res = await DELETE(new NextRequest('http://localhost/x'), ctxParams())

    expect(res.status).toBe(200)
    expect(deleteIntegration).toHaveBeenCalledWith('int-1', 'rest-1')
  })

  it('404s for a foreign-tenant id via the scoped query', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)

    const res = await DELETE(new NextRequest('http://localhost/x'), ctxParams())

    expect(res.status).toBe(404)
    expect(deleteIntegration).not.toHaveBeenCalled()
  })
})
