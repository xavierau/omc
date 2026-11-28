import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-event-repository', () => ({
  insertIntegrationEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-delivery-repository', () => ({
  findQueuedUnenqueuedDeliveriesForEvent: vi.fn(),
  markEnqueued: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/infrastructure/queue/integration-outbound-queue', () => ({
  addDeliverJob: vi.fn().mockResolvedValue(undefined),
}))

import { insertIntegrationEvent } from '@/infrastructure/supabase/repositories/integration-event-repository'
import {
  findQueuedUnenqueuedDeliveriesForEvent,
  markEnqueued,
} from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { addDeliverJob } from '@/infrastructure/queue/integration-outbound-queue'
import { IntegrationDelivery, type IntegrationDeliveryProps } from '@/domain/entities/integration-delivery'
import { emitIntegrationEvent, getIntegrationEventPublisher } from '../emit-integration-event'
import type { IntegrationEvent } from '@/domain/entities/integration-event'

function delivery(id: string, overrides: Partial<IntegrationDeliveryProps> = {}): IntegrationDelivery {
  return IntegrationDelivery.fromProps({
    id,
    integrationId: 'int-1',
    restaurantId: 'r-1',
    eventId: 'evt_1',
    status: 'queued',
    attempts: 0,
    lastHttpStatus: null,
    lastErrorCode: null,
    lastLatencyMs: null,
    responseExcerpt: null,
    nextRetryAt: null,
    enqueuedAt: null,
    deliveredAt: null,
    deadLetteredAt: null,
    retriedAt: null,
    ...overrides,
  })
}

const baseEvent: IntegrationEvent = {
  id: 'evt_1',
  restaurantId: 'r-1',
  memberId: 'm-1',
  type: 'member.created',
  changed: [],
  originIntegrationId: 'int-1',
  occurredAt: '2026-09-10T00:00:00.000Z',
  source: 'partner_api',
}

describe('emitIntegrationEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(insertIntegrationEvent).mockResolvedValue(undefined)
    vi.mocked(markEnqueued).mockResolvedValue(undefined)
    vi.mocked(addDeliverJob).mockResolvedValue(undefined)
  })

  it('inserts the event carrying source and origin_integration_id', async () => {
    vi.mocked(findQueuedUnenqueuedDeliveriesForEvent).mockResolvedValue([])

    await emitIntegrationEvent(baseEvent)

    expect(insertIntegrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'evt_1', source: 'partner_api', originIntegrationId: 'int-1' })
    )
  })

  it('fast-path enqueues every delivery the fan-out trigger just created, then stamps enqueued_at', async () => {
    vi.mocked(findQueuedUnenqueuedDeliveriesForEvent).mockResolvedValue([delivery('del-1'), delivery('del-2')])

    await emitIntegrationEvent(baseEvent)

    expect(addDeliverJob).toHaveBeenCalledWith('del-1')
    expect(addDeliverJob).toHaveBeenCalledWith('del-2')
    expect(markEnqueued).toHaveBeenCalledWith('del-1', expect.any(String))
    expect(markEnqueued).toHaveBeenCalledWith('del-2', expect.any(String))
  })

  it('never throws when the fan-out lookup fails -- the event is already durably recorded; the relay is the backstop', async () => {
    vi.mocked(findQueuedUnenqueuedDeliveriesForEvent).mockRejectedValue(new Error('redis down'))

    await expect(emitIntegrationEvent(baseEvent)).resolves.toBeUndefined()
    expect(insertIntegrationEvent).toHaveBeenCalledTimes(1)
  })

  it('never throws when a single delivery enqueue fails -- other deliveries for the same event still enqueue', async () => {
    vi.mocked(findQueuedUnenqueuedDeliveriesForEvent).mockResolvedValue([delivery('del-1'), delivery('del-2')])
    vi.mocked(addDeliverJob).mockImplementation((id: string) =>
      id === 'del-1' ? Promise.reject(new Error('queue.add failed')) : Promise.resolve()
    )

    await expect(emitIntegrationEvent(baseEvent)).resolves.toBeUndefined()
    expect(markEnqueued).toHaveBeenCalledWith('del-2', expect.any(String))
    expect(markEnqueued).not.toHaveBeenCalledWith('del-1', expect.any(String))
  })

  it('propagates a failure inserting the event itself -- unlike the fan-out enqueue, this is NOT best-effort', async () => {
    vi.mocked(insertIntegrationEvent).mockRejectedValue(new Error('unique violation'))

    await expect(emitIntegrationEvent(baseEvent)).rejects.toThrow('unique violation')
    expect(findQueuedUnenqueuedDeliveriesForEvent).not.toHaveBeenCalled()
  })
})

describe('getIntegrationEventPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(insertIntegrationEvent).mockResolvedValue(undefined)
  })

  it('returns a publisher whose publish() is emitIntegrationEvent (the seam default wiring)', async () => {
    vi.mocked(findQueuedUnenqueuedDeliveriesForEvent).mockResolvedValue([])
    const publisher = getIntegrationEventPublisher()

    await publisher.publish(baseEvent)

    expect(insertIntegrationEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt_1' }))
  })
})
