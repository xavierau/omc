import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-delivery-repository')
vi.mock('@/infrastructure/supabase/repositories/integration-event-repository')

import { findDeliveriesForIntegration } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { findIntegrationEventsByIds } from '@/infrastructure/supabase/repositories/integration-event-repository'
import { listIntegrationDeliveries } from '../list-integration-deliveries'

beforeEach(() => {
  vi.clearAllMocks()
})

function row(overrides: Partial<Awaited<ReturnType<typeof findDeliveriesForIntegration>>[number]> = {}) {
  return {
    id: 'del-1',
    eventId: 'evt-1',
    status: 'delivered' as const,
    attempts: 1,
    lastHttpStatus: 200,
    lastErrorCode: null,
    nextRetryAt: null,
    createdAt: '2026-09-10T00:00:00Z',
    ...overrides,
  }
}

describe('listIntegrationDeliveries', () => {
  it('batches event lookups in one call, never one per row (N+1 guard)', async () => {
    vi.mocked(findDeliveriesForIntegration).mockResolvedValue([
      row({ id: 'd1', eventId: 'e1' }),
      row({ id: 'd2', eventId: 'e2' }),
      row({ id: 'd3', eventId: 'e1' }),
    ])
    vi.mocked(findIntegrationEventsByIds).mockResolvedValue([
      { id: 'e1', type: 'member.created', occurredAt: '2026-09-10T00:00:00Z' },
      { id: 'e2', type: 'ping', occurredAt: '2026-09-10T00:01:00Z' },
    ])

    const result = await listIntegrationDeliveries('int-1', 'rest-1', {})

    expect(findIntegrationEventsByIds).toHaveBeenCalledTimes(1)
    expect(findIntegrationEventsByIds).toHaveBeenCalledWith(['e1', 'e2'])
    expect(result.data).toHaveLength(3)
    expect(result.data[0].eventType).toBe('member.created')
    expect(result.data[1].eventType).toBe('ping')
  })

  it('caps the page size at 500 and forwards status/cursor', async () => {
    vi.mocked(findDeliveriesForIntegration).mockResolvedValue([])
    vi.mocked(findIntegrationEventsByIds).mockResolvedValue([])

    await listIntegrationDeliveries('int-1', 'rest-1', { status: 'dead_lettered', cursor: 'c1', limit: 10000 })

    expect(findDeliveriesForIntegration).toHaveBeenCalledWith('int-1', 'rest-1', {
      status: 'dead_lettered',
      cursor: 'c1',
      limit: 500,
    })
  })

  it('returns nextCursor only when the page was full', async () => {
    vi.mocked(findDeliveriesForIntegration).mockResolvedValue([row({ createdAt: '2026-09-10T01:00:00Z' })])
    vi.mocked(findIntegrationEventsByIds).mockResolvedValue([])

    const full = await listIntegrationDeliveries('int-1', 'rest-1', { limit: 1 })
    expect(full.nextCursor).toBe('2026-09-10T01:00:00Z')

    vi.mocked(findDeliveriesForIntegration).mockResolvedValue([row()])
    const partial = await listIntegrationDeliveries('int-1', 'rest-1', { limit: 2 })
    expect(partial.nextCursor).toBeNull()
  })
})
