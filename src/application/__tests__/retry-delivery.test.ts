import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-delivery-repository', () => ({
  findDeliveryById: vi.fn(),
  saveDelivery: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/infrastructure/queue/integration-outbound-queue', () => ({
  addRetryDeliverJob: vi.fn().mockResolvedValue(undefined),
}))

import { findDeliveryById, saveDelivery } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { addRetryDeliverJob } from '@/infrastructure/queue/integration-outbound-queue'
import { IntegrationDelivery, type IntegrationDeliveryProps } from '@/domain/entities/integration-delivery'
import { retryDelivery } from '../retry-delivery'

function delivery(overrides: Partial<IntegrationDeliveryProps> = {}): IntegrationDelivery {
  return IntegrationDelivery.fromProps({
    id: 'del-1',
    integrationId: 'int-1',
    restaurantId: 'r-1',
    eventId: 'evt_1',
    status: 'dead_lettered',
    attempts: 5,
    lastHttpStatus: 503,
    lastErrorCode: null,
    lastLatencyMs: 10,
    responseExcerpt: null,
    nextRetryAt: null,
    enqueuedAt: '2026-09-10T00:00:00.000Z',
    deliveredAt: null,
    deadLetteredAt: '2026-09-10T00:10:00.000Z',
    retriedAt: null,
    ...overrides,
  })
}

describe('retryDelivery (WI-6 Tests-first: "Retry twice -> 409, one delivery attempt")', () => {
  beforeEach(() => vi.clearAllMocks())

  it('transitions dead_lettered -> queued, stamps retriedAt, and enqueues the r1 job', async () => {
    vi.mocked(findDeliveryById).mockResolvedValue(delivery())

    const result = await retryDelivery('del-1')

    expect(result).toEqual({ ok: true })
    expect(saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: expect.objectContaining({ status: 'queued', retriedAt: expect.any(String) }) })
    )
    expect(addRetryDeliverJob).toHaveBeenCalledWith('del-1')
  })

  it('a second retry on the same delivery returns already_retried and does NOT enqueue a second job', async () => {
    vi.mocked(findDeliveryById).mockResolvedValue(delivery({ retriedAt: '2026-09-10T00:11:00.000Z' }))

    const result = await retryDelivery('del-1')

    expect(result).toEqual({ ok: false, error: 'already_retried' })
    expect(addRetryDeliverJob).not.toHaveBeenCalled()
    expect(saveDelivery).not.toHaveBeenCalled()
  })

  it('a non-dead-lettered delivery (e.g. still queued) is rejected rather than force-retried', async () => {
    vi.mocked(findDeliveryById).mockResolvedValue(delivery({ status: 'queued' }))

    const result = await retryDelivery('del-1')

    expect(result).toEqual({ ok: false, error: 'not_dead_lettered' })
    expect(addRetryDeliverJob).not.toHaveBeenCalled()
  })

  it('an unknown delivery id returns not_found', async () => {
    vi.mocked(findDeliveryById).mockResolvedValue(null)

    const result = await retryDelivery('del-missing')
    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('a delivery that dead-lettered AGAIN after its one retry (retriedAt still set) is rejected a second time too', async () => {
    // Realistic re-failure path: queued -> delivering -> dead_lettered again,
    // with retriedAt untouched by the second failure -- the guard is
    // "has this event EVER been retried", not "is it currently dead_lettered
    // for the first time".
    vi.mocked(findDeliveryById).mockResolvedValue(
      delivery({ status: 'dead_lettered', retriedAt: '2026-09-10T00:11:00.000Z', attempts: 6 })
    )

    const result = await retryDelivery('del-1')

    expect(result).toEqual({ ok: false, error: 'already_retried' })
    expect(addRetryDeliverJob).not.toHaveBeenCalled()
  })
})
