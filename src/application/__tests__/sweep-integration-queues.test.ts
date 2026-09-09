import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-delivery-repository', () => ({
  findDeliveriesToRelay: vi.fn(),
  markEnqueued: vi.fn().mockResolvedValue(undefined),
  listIntegrationIdsWithDeliveries: vi.fn().mockResolvedValue([]),
  pruneDeliveriesForIntegration: vi.fn().mockResolvedValue(0),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-event-repository', () => ({
  pruneOrphanIntegrationEvents: vi.fn().mockResolvedValue(0),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-anomaly-stats-repository', () => ({
  findIntegrationVolumeAnomalies: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/infrastructure/queue/integration-outbound-queue', () => ({
  addDeliverJob: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/application/notify-ops-alert', () => ({
  notifyOpsAlert: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/application/reconcile-integration-depth-counters', () => ({
  reconcileAllIntegrationDepthCounters: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/infrastructure/queue/integration-inbound-queue', () => ({
  getInboundRateLimiter: vi.fn().mockReturnValue({ fake: 'rate-limiter' }),
}))

import {
  findDeliveriesToRelay,
  listIntegrationIdsWithDeliveries,
  markEnqueued,
  pruneDeliveriesForIntegration,
} from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { pruneOrphanIntegrationEvents } from '@/infrastructure/supabase/repositories/integration-event-repository'
import { findIntegrationVolumeAnomalies } from '@/infrastructure/supabase/repositories/integration-anomaly-stats-repository'
import { addDeliverJob } from '@/infrastructure/queue/integration-outbound-queue'
import { notifyOpsAlert } from '@/application/notify-ops-alert'
import { reconcileAllIntegrationDepthCounters } from '@/application/reconcile-integration-depth-counters'
import { getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { IntegrationDelivery, type IntegrationDeliveryProps } from '@/domain/entities/integration-delivery'
import { relayQueuedDeliveries, runMaintenanceSweep } from '../sweep-integration-queues'

function delivery(id: string): IntegrationDelivery {
  const props: IntegrationDeliveryProps = {
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
  }
  return IntegrationDelivery.fromProps(props)
}

describe('relayQueuedDeliveries (WI-6 Tests-first: "relay picks queued AND enqueued_at IS NULL only")', () => {
  beforeEach(() => vi.clearAllMocks())

  it('enqueues every row findDeliveriesToRelay returns, then stamps enqueued_at', async () => {
    vi.mocked(findDeliveriesToRelay).mockResolvedValue([delivery('del-1'), delivery('del-2')])

    await relayQueuedDeliveries()

    expect(findDeliveriesToRelay).toHaveBeenCalledWith({ olderThanMs: 5000, limit: 200 })
    expect(addDeliverJob).toHaveBeenCalledWith('del-1')
    expect(addDeliverJob).toHaveBeenCalledWith('del-2')
    expect(markEnqueued).toHaveBeenCalledWith('del-1', expect.any(String))
    expect(markEnqueued).toHaveBeenCalledWith('del-2', expect.any(String))
  })

  it('WI-6 Tests-first: "double run -> no duplicate jobs" -- two relay ticks over the same still-unenqueued row each call addDeliverJob with the SAME deliveryId (BullMQ jobId=deliveryId dedupes)', async () => {
    vi.mocked(findDeliveriesToRelay).mockResolvedValue([delivery('del-1')])

    await relayQueuedDeliveries()
    await relayQueuedDeliveries()

    expect(addDeliverJob).toHaveBeenCalledTimes(2)
    expect(addDeliverJob).toHaveBeenNthCalledWith(1, 'del-1')
    expect(addDeliverJob).toHaveBeenNthCalledWith(2, 'del-1')
  })

  it('a single failing enqueue does not stop the others in the same tick', async () => {
    vi.mocked(findDeliveriesToRelay).mockResolvedValue([delivery('del-1'), delivery('del-2')])
    vi.mocked(addDeliverJob).mockImplementation((id: string) =>
      id === 'del-1' ? Promise.reject(new Error('redis down')) : Promise.resolve()
    )

    await expect(relayQueuedDeliveries()).resolves.toBeUndefined()
    expect(markEnqueued).toHaveBeenCalledWith('del-2', expect.any(String))
  })
})

describe('runMaintenanceSweep', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prunes deliveries per integration, prunes orphan events, and checks anomalies -- in that order', async () => {
    vi.mocked(listIntegrationIdsWithDeliveries).mockResolvedValue(['int-1', 'int-2'])

    await runMaintenanceSweep()

    expect(pruneDeliveriesForIntegration).toHaveBeenCalledWith('int-1', 500, 30)
    expect(pruneDeliveriesForIntegration).toHaveBeenCalledWith('int-2', 500, 30)
    expect(pruneOrphanIntegrationEvents).toHaveBeenCalledWith(30)
    expect(findIntegrationVolumeAnomalies).toHaveBeenCalledWith({ multiplier: 3, minLastHourVolume: 10 })
  })

  it('WI-6 Tests-first: "anomaly alert fires at > 3x baseline" -- one alert per flagged integration', async () => {
    vi.mocked(findIntegrationVolumeAnomalies).mockResolvedValue([
      { integrationId: 'int-hot', restaurantId: 'r-1', lastHourCount: 30, sevenDayHourlyAverage: 2 },
    ])

    await runMaintenanceSweep()

    expect(notifyOpsAlert).toHaveBeenCalledTimes(1)
    expect(notifyOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'engineering_alert',
        restaurantId: 'r-1',
        details: expect.objectContaining({ integrationId: 'int-hot', lastHourCount: 30 }),
      })
    )
  })

  it('a pruning failure for one integration does not stop pruning for the others', async () => {
    vi.mocked(listIntegrationIdsWithDeliveries).mockResolvedValue(['int-1', 'int-2'])
    vi.mocked(pruneDeliveriesForIntegration).mockImplementation((id: string) =>
      id === 'int-1' ? Promise.reject(new Error('db error')) : Promise.resolve(0)
    )

    await expect(runMaintenanceSweep()).resolves.toBeUndefined()
    expect(pruneDeliveriesForIntegration).toHaveBeenCalledWith('int-2', 500, 30)
  })

  // WI-13 (Gap B): the depth-counter rebuild the plan's own architecture
  // text assigns to "the 5-min sweeper" -- WI-6 deliberately excluded it
  // (see this file's own module header history / WI-6's handoff), flagged
  // as an unresolved-ownership gap. This dispatch closes it.
  it('reconciles per-integration depth counters against the real inbound rate limiter', async () => {
    await runMaintenanceSweep()

    expect(getInboundRateLimiter).toHaveBeenCalled()
    expect(reconcileAllIntegrationDepthCounters).toHaveBeenCalledWith(
      vi.mocked(getInboundRateLimiter).mock.results[0]?.value
    )
  })

  it('a depth-counter reconciliation failure does not stop the rest of the sweep', async () => {
    vi.mocked(reconcileAllIntegrationDepthCounters).mockRejectedValue(new Error('redis down'))
    vi.mocked(listIntegrationIdsWithDeliveries).mockResolvedValue(['int-1'])

    await expect(runMaintenanceSweep()).resolves.toBeUndefined()
    expect(pruneDeliveriesForIntegration).toHaveBeenCalledWith('int-1', 500, 30)
    expect(pruneOrphanIntegrationEvents).toHaveBeenCalledWith(30)
  })
})
