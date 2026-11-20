import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/configure-pos-integration')
vi.mock('@/application/list-integration-deliveries')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getIntegration } from '@/application/configure-pos-integration'
import { listIntegrationDeliveries } from '@/application/list-integration-deliveries'
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
  vi.mocked(listIntegrationDeliveries).mockResolvedValue({ data: [], nextCursor: null })
})

describe('GET /api/dashboard/pos-integrations/[id]/deliveries', () => {
  it('rejects staff with 403', async () => {
    mockRole('staff')
    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())
    expect(res.status).toBe(403)
    expect(listIntegrationDeliveries).not.toHaveBeenCalled()
  })

  it('404s for a foreign-tenant id', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())
    expect(res.status).toBe(404)
  })

  it('forwards a valid status filter and cursor', async () => {
    await GET(new NextRequest('http://localhost/x?status=dead_lettered&cursor=2026-09-10T00:00:00Z'), ctxParams())
    expect(listIntegrationDeliveries).toHaveBeenCalledWith('int-1', 'rest-1', {
      status: 'dead_lettered',
      cursor: '2026-09-10T00:00:00Z',
    })
  })

  it('ignores an invalid status value rather than passing it through', async () => {
    await GET(new NextRequest('http://localhost/x?status=not-a-real-status'), ctxParams())
    expect(listIntegrationDeliveries).toHaveBeenCalledWith('int-1', 'rest-1', { status: undefined, cursor: undefined })
  })

  it('returns the data + nextCursor shape', async () => {
    vi.mocked(listIntegrationDeliveries).mockResolvedValue({
      data: [
        {
          id: 'd1',
          eventId: 'e1',
          eventType: 'member.created',
          occurredAt: '2026-09-10T00:00:00Z',
          status: 'delivered',
          attempts: 1,
          lastHttpStatus: 200,
          lastErrorCode: null,
          nextRetryAt: null,
          createdAt: '2026-09-10T00:00:00Z',
        },
      ],
      nextCursor: '2026-09-09T00:00:00Z',
    })

    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toHaveLength(1)
    expect(json.nextCursor).toBe('2026-09-09T00:00:00Z')
  })
})
