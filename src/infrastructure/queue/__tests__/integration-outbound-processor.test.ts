import { describe, it, expect, vi, beforeEach } from 'vitest'

const { MockWorker, MockUnrecoverableError, MockDelayedError, registeredHandlers, workerCtorArgs } = vi.hoisted(() => {
  const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const workerCtorArgs: unknown[] = []

  class MockUnrecoverableError extends Error {}
  class MockDelayedError extends Error {}

  class MockWorker {
    constructor(...args: unknown[]) {
      workerCtorArgs.push(args)
    }
    on(event: string, cb: (...args: unknown[]) => unknown) {
      registeredHandlers.set(event, cb)
      return this
    }
  }

  return { MockWorker, MockUnrecoverableError, MockDelayedError, registeredHandlers, workerCtorArgs }
})

vi.mock('bullmq', () => ({
  Worker: MockWorker,
  UnrecoverableError: MockUnrecoverableError,
  DelayedError: MockDelayedError,
}))

vi.mock('ioredis', () => ({
  default: class MockRedis {},
}))

vi.mock('@/application/deliver-outbound-webhook', () => ({
  deliverOutboundWebhook: vi.fn(),
}))
vi.mock('@/application/sweep-integration-queues', () => ({
  relayQueuedDeliveries: vi.fn().mockResolvedValue(undefined),
  runMaintenanceSweep: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-delivery-repository', () => ({
  findDeliveryById: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository', () => ({
  findIntegrationSettingsById: vi.fn(),
}))
vi.mock('@/infrastructure/rate-limit/redis-rate-limiter', () => ({
  RedisRateLimiter: class MockRedisRateLimiter {
    takeToken = vi.fn().mockResolvedValue({ allowed: true, remaining: 9, retryAfterSec: 0 })
  },
}))
vi.mock('@/infrastructure/queue/integration-outbound-queue', async () => {
  const actual = await vi.importActual<typeof import('../integration-outbound-queue')>(
    '../integration-outbound-queue'
  )
  return {
    ...actual,
    ensureSweepSchedulersRegistered: vi.fn().mockResolvedValue(undefined),
  }
})

import { deliverOutboundWebhook } from '@/application/deliver-outbound-webhook'
import { relayQueuedDeliveries, runMaintenanceSweep } from '@/application/sweep-integration-queues'
import { findDeliveryById } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { IntegrationDelivery, type IntegrationDeliveryProps } from '@/domain/entities/integration-delivery'
import { IntegrationSettings, type IntegrationSettingsProps } from '@/domain/entities/integration-settings'

function delivery(overrides: Partial<IntegrationDeliveryProps> = {}): IntegrationDelivery {
  return IntegrationDelivery.fromProps({
    id: 'del-1',
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

function settings(overrides: Partial<IntegrationSettingsProps> = {}): IntegrationSettings {
  return IntegrationSettings.fromProps({
    integrationId: 'int-1',
    restaurantId: 'r-1',
    newJoinTemplateId: null,
    consentAttestationText: null,
    consentAttestationAckAt: null,
    consentAttestationAckBy: null,
    outboundUrl: 'https://partner.example.test/hook',
    outboundSecretLast4: 'abcd',
    outboundSecretUpdatedAt: null,
    outboundSecretUpdatedBy: null,
    outboundEvents: ['member.created'],
    outboundEnabled: true,
    outboundPiiAckAt: '2026-09-01T00:00:00.000Z',
    outboundPiiAckBy: 'u-1',
    outboundStatus: 'active',
    outboundFailureStreak: 0,
    outboundPausedAt: null,
    inboundRatePerMin: null,
    inboundBurst: null,
    inboundQueueCap: null,
    inboundSecretUpdatedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  })
}

async function loadProcessorFresh() {
  vi.resetModules()
  return import('../integration-outbound-processor')
}

function jobHandler() {
  const lastCallArgs = workerCtorArgs[workerCtorArgs.length - 1] as unknown[]
  return lastCallArgs[1] as (job: Record<string, unknown>, token?: string) => Promise<void>
}

describe('integration-outbound-processor job dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workerCtorArgs.length = 0
    registeredHandlers.clear()
    vi.mocked(findDeliveryById).mockResolvedValue(null)
  })

  it('deliver job -> deliverOutboundWebhook is called with the delivery id and 1-based attempt number', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    vi.mocked(deliverOutboundWebhook).mockResolvedValue({ kind: 'delivered' })
    ensureWorkerStarted()

    const moveToDelayed = vi.fn()
    await jobHandler()(
      { name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 2, opts: { attempts: 5 }, moveToDelayed },
      'tok'
    )

    expect(deliverOutboundWebhook).toHaveBeenCalledWith('del-1', 3, { isFinalAttempt: false })
  })

  it('C-1: on the final attempt (attemptsMade + 1 >= job.opts.attempts), deliverOutboundWebhook receives isFinalAttempt: true', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    vi.mocked(deliverOutboundWebhook).mockResolvedValue({ kind: 'permanent' })
    ensureWorkerStarted()

    await expect(
      jobHandler()(
        { name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 4, opts: { attempts: 5 }, moveToDelayed: vi.fn() },
        'tok'
      )
    ).rejects.toThrow(MockUnrecoverableError)

    expect(deliverOutboundWebhook).toHaveBeenCalledWith('del-1', 5, { isFinalAttempt: true })
  })

  it('C-1: a non-final attempt (attemptsMade + 1 < job.opts.attempts) passes isFinalAttempt: false', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    vi.mocked(deliverOutboundWebhook).mockResolvedValue({ kind: 'transient' })
    ensureWorkerStarted()

    await expect(
      jobHandler()(
        { name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 1, opts: { attempts: 5 }, moveToDelayed: vi.fn() },
        'tok'
      )
    ).rejects.toThrow(Error)

    expect(deliverOutboundWebhook).toHaveBeenCalledWith('del-1', 2, { isFinalAttempt: false })
  })

  it('C-1: falls back to the default attempts budget (5) when job.opts is missing', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    vi.mocked(deliverOutboundWebhook).mockResolvedValue({ kind: 'permanent' })
    ensureWorkerStarted()

    await expect(
      jobHandler()(
        { name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 4, moveToDelayed: vi.fn() },
        'tok'
      )
    ).rejects.toThrow(MockUnrecoverableError)

    expect(deliverOutboundWebhook).toHaveBeenCalledWith('del-1', 5, { isFinalAttempt: true })
  })

  it('delivered/paused outcomes resolve without throwing', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    ensureWorkerStarted()
    const handler = jobHandler()

    vi.mocked(deliverOutboundWebhook).mockResolvedValue({ kind: 'delivered' })
    await expect(handler({ name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 0, moveToDelayed: vi.fn() })).resolves.toBeUndefined()

    vi.mocked(deliverOutboundWebhook).mockResolvedValue({ kind: 'paused' })
    await expect(handler({ name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 0, moveToDelayed: vi.fn() })).resolves.toBeUndefined()
  })

  it('permanent outcome throws UnrecoverableError (T-M8: straight to dead-letter, no further BullMQ retries)', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    ensureWorkerStarted()
    vi.mocked(deliverOutboundWebhook).mockResolvedValue({ kind: 'permanent' })

    await expect(
      jobHandler()({ name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 0, moveToDelayed: vi.fn() })
    ).rejects.toThrow(MockUnrecoverableError)
  })

  it('transient outcome with no retryAfterSec throws a plain Error (ordinary BullMQ exponential backoff)', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    ensureWorkerStarted()
    vi.mocked(deliverOutboundWebhook).mockResolvedValue({ kind: 'transient' })

    await expect(
      jobHandler()({ name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 0, moveToDelayed: vi.fn() })
    ).rejects.not.toThrow(MockDelayedError)
    await expect(
      jobHandler()({ name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 0, moveToDelayed: vi.fn() })
    ).rejects.toThrow(Error)
  })

  it('transient outcome WITH retryAfterSec (429) calls job.moveToDelayed then throws DelayedError', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    ensureWorkerStarted()
    vi.mocked(deliverOutboundWebhook).mockResolvedValue({ kind: 'transient', retryAfterSec: 120 })
    const moveToDelayed = vi.fn().mockResolvedValue(undefined)

    await expect(
      jobHandler()({ name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 0, moveToDelayed }, 'tok')
    ).rejects.toThrow(MockDelayedError)
    expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'tok')
  })

  it('relay job name dispatches to relayQueuedDeliveries', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    ensureWorkerStarted()

    await jobHandler()({ name: 'relay', data: {}, attemptsMade: 0, moveToDelayed: vi.fn() })
    expect(relayQueuedDeliveries).toHaveBeenCalledTimes(1)
  })

  it('maintenance job name dispatches to runMaintenanceSweep', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    ensureWorkerStarted()

    await jobHandler()({ name: 'maintenance', data: {}, attemptsMade: 0, moveToDelayed: vi.fn() })
    expect(runMaintenanceSweep).toHaveBeenCalledTimes(1)
  })

  it('an unknown job name throws UnrecoverableError rather than silently succeeding', async () => {
    const { ensureWorkerStarted } = await loadProcessorFresh()
    ensureWorkerStarted()

    await expect(
      jobHandler()({ name: 'mystery', data: {}, attemptsMade: 0, moveToDelayed: vi.fn() })
    ).rejects.toThrow(MockUnrecoverableError)
  })
})

describe('per-destination-host throttle (kanban INT-001 constraint b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workerCtorArgs.length = 0
  })

  it('when the host budget is exhausted, delays the job and never calls deliverOutboundWebhook', async () => {
    vi.doMock('@/infrastructure/rate-limit/redis-rate-limiter', () => ({
      RedisRateLimiter: class MockRedisRateLimiter {
        takeToken = vi.fn().mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 1 })
      },
    }))
    vi.mocked(findDeliveryById).mockResolvedValue(delivery())
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(settings())

    const { ensureWorkerStarted } = await loadProcessorFresh()
    ensureWorkerStarted()
    const moveToDelayed = vi.fn().mockResolvedValue(undefined)

    await expect(
      jobHandler()({ name: 'deliver', data: { deliveryId: 'del-1' }, attemptsMade: 0, moveToDelayed }, 'tok')
    ).rejects.toThrow(MockDelayedError)
    expect(moveToDelayed).toHaveBeenCalled()
    expect(deliverOutboundWebhook).not.toHaveBeenCalled()

    vi.doUnmock('@/infrastructure/rate-limit/redis-rate-limiter')
  })
})
