// INT-001 WI-6: BullMQ Worker for the `integration-outbound` queue.
// Job-name dispatch: `deliver` -> deliverOutboundWebhook (+ per-host
// throttle pre-check), `relay` -> the 30s relay, `maintenance` -> the 5min
// sweep. Permanent/transient split reuses the `email-job-processor.ts`
// shape (T-M8): `UnrecoverableError` skips straight to dead-letter,
// `DelayedError` (after `job.moveToDelayed`) honours a computed delay
// (per-host throttle exhaustion, or a 429's `Retry-After`), a plain
// `Error` falls through to BullMQ's own exponential backoff.

import { Worker, UnrecoverableError, DelayedError, type Job } from 'bullmq'
import Redis from 'ioredis'
import { deliverOutboundWebhook } from '@/application/deliver-outbound-webhook'
import { relayQueuedDeliveries, runMaintenanceSweep } from '@/application/sweep-integration-queues'
import { findDeliveryById } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { RedisRateLimiter } from '@/infrastructure/rate-limit/redis-rate-limiter'
import { getFailFastRedisOptions, parseRedisUrl, redisUrl } from '@/infrastructure/redis/connection'
import {
  QUEUE_NAME,
  ensureSweepSchedulersRegistered,
  outboundConcurrencyFromEnv,
  type DeliverJobData,
  type OutboundJobData,
} from './integration-outbound-queue'

// Queues table: `{ max: 20, duration: 1000 }` (BullMQ Worker-level limiter,
// across ALL jobs regardless of destination) + a per-destination-host
// Redis budget of 10 req/s (below), so one slow/noisy partner host can't
// starve delivery to every other integration sharing this worker.
const WORKER_LIMITER_MAX = 20
const WORKER_LIMITER_DURATION_MS = 1000
const PER_HOST_RATE_PER_MIN = 600 // 10 req/s
const PER_HOST_BURST = 10
const PER_HOST_THROTTLE_DELAY_MS = 1000

let hostLimiter: RedisRateLimiter | null = null

function getHostLimiter(): RedisRateLimiter {
  if (!hostLimiter) hostLimiter = new RedisRateLimiter(new Redis(getFailFastRedisOptions()))
  return hostLimiter
}

function getWorkerRedisConnection() {
  return { ...parseRedisUrl(redisUrl()), maxRetriesPerRequest: null as null }
}

/** Best-effort: a Redis hiccup on the throttle check itself fails OPEN
 * (allows the attempt through) rather than blocking every delivery on a
 * check that isn't the actual delivery attempt -- `deliverOutboundWebhook`
 * itself still fails closed on any REAL outage via its own Postgres/sender
 * calls. */
async function checkPerHostBudget(hostname: string): Promise<{ allowed: boolean }> {
  try {
    const result = await getHostLimiter().takeToken(`int001:host:${hostname}`, {
      ratePerMin: PER_HOST_RATE_PER_MIN,
      burst: PER_HOST_BURST,
    })
    return { allowed: result.allowed }
  } catch {
    return { allowed: true }
  }
}

function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

async function handleDeliverJob(job: Job<DeliverJobData>, token: string | undefined): Promise<void> {
  const { deliveryId } = job.data

  const delivery = await findDeliveryById(deliveryId)
  if (delivery) {
    const settings = await findIntegrationSettingsById(delivery.snapshot.integrationId)
    const hostname = settings?.snapshot.outboundUrl ? extractHostname(settings.snapshot.outboundUrl) : null
    if (hostname) {
      const budget = await checkPerHostBudget(hostname)
      if (!budget.allowed) {
        await job.moveToDelayed(Date.now() + PER_HOST_THROTTLE_DELAY_MS, token)
        throw new DelayedError()
      }
    }
  }

  const attemptNumber = job.attemptsMade + 1
  const result = await deliverOutboundWebhook(deliveryId, attemptNumber)

  if (result.kind === 'delivered' || result.kind === 'paused') return
  if (result.kind === 'permanent') {
    throw new UnrecoverableError(`integration-outbound: delivery ${deliveryId} permanently failed`)
  }
  // transient
  if (result.retryAfterSec !== undefined) {
    await job.moveToDelayed(Date.now() + result.retryAfterSec * 1000, token)
    throw new DelayedError()
  }
  throw new Error(`integration-outbound: delivery ${deliveryId} failed, will retry`)
}

function createWorker(): Worker<OutboundJobData> {
  const worker = new Worker<OutboundJobData>(
    QUEUE_NAME,
    async (job, token) => {
      if (job.name === 'deliver') return handleDeliverJob(job as Job<DeliverJobData>, token)
      if (job.name === 'relay') return relayQueuedDeliveries()
      if (job.name === 'maintenance') return runMaintenanceSweep()
      throw new UnrecoverableError(`integration-outbound: unknown job name "${job.name}"`)
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: outboundConcurrencyFromEnv(),
      limiter: { max: WORKER_LIMITER_MAX, duration: WORKER_LIMITER_DURATION_MS },
    }
  )

  worker.on('failed', (job, err) => {
    console.error(`[IntegrationOutboundQueue] Job ${job?.id} (${job?.name ?? 'unknown'}) failed:`, err.message)
  })

  return worker
}

let worker: Worker<OutboundJobData> | null = null

export function ensureWorkerStarted(): void {
  if (worker) return
  worker = createWorker()
  ensureSweepSchedulersRegistered().catch((err) => {
    console.error('[IntegrationOutboundQueue] Failed to register sweep schedulers:', err)
  })
  console.log('[IntegrationOutboundQueue] Worker started')
}

export function getWorker(): Worker<OutboundJobData> | null {
  return worker
}
