// INT-001 WI-3: the `integration-inbound` BullMQ queue (plan §Queues).
// Carries two job names: `member-create` (this WI's own processor) and
// `welcome-send` (WI-4's real processor -- `integration-inbound-processor.ts`
// runs a stub for it until WI-4 lands, see that file's header).
//
// Job payloads are ids + validated fields ONLY -- this IS the request body,
// already normalised, never the raw partner input (T-H7's sibling
// discipline for the outbound queue applies here too: keep Redis retention
// small and structured).
//
// This file also hosts TWO small pieces of shared Redis-backed
// infrastructure for the whole inbound pipeline, kept here (rather than as
// new top-level files not named in the plan) because both need a live
// Redis connection this queue already owns the lifecycle of:
//   - `getInboundRateLimiter()`: the `RedisRateLimiter` (WI-2's class)
//     instance used by `authenticateIntegrationV2`/`guardInboundRequest`
//     AND by `enqueue-member-create.ts`'s per-integration depth counter
//     (`RateLimiterPort.incr/decr` -- the port's own docstring names this
//     exact use).
//   - `getInboundQueueDepthSource()`: wraps `getWaitingCount() +
//     getDelayedCount()` for WI-2's `GlobalQueueCeilingGuard` (T-M7), which
//     WI-2 built generic specifically because this queue didn't exist yet.

import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { getFailFastRedisOptions, parseRedisUrl, redisUrl } from '@/infrastructure/redis/connection'
import { RedisRateLimiter } from '@/infrastructure/rate-limit/redis-rate-limiter'
import {
  GlobalQueueCeilingGuard,
  globalQueueCeilingFromEnv,
  type QueueDepthSource,
} from '@/application/check-global-queue-ceiling'
import { systemClock } from '@/infrastructure/clock/system-clock'

export const QUEUE_NAME = 'integration-inbound'

export interface MemberCreateJobData {
  jobId: string
  integrationId: string
  restaurantId: string
  phoneE164: string
  consentLevel: 'none' | 'utility' | 'all'
  name: string | null
  externalRef: string | null
  language: 'en' | 'zh_hk' | null
  sendWelcome: boolean
  metadata: Record<string, unknown> | null
}

export interface WelcomeSendJobData {
  memberId: string
  restaurantId: string
  integrationId: string
  createJobId: string
}

// BullMQ producer connections fail fast (T-H5's posture, mirrored for the
// queue itself): an unreachable Redis must surface as a rejected `.add()`
// within the route's own 3s wrapper, never hang or silently queue offline.
function getProducerConnection() {
  return getFailFastRedisOptions()
}

// The Worker's own connection is intentionally NOT fail-fast --
// long-running workers are expected to retry/reconnect on a transient
// Redis blip (BullMQ's own default `maxRetriesPerRequest: null` for
// blocking connections), matching every other queue in this repo
// (event-dispatch-queue.ts, email-queue.ts).
function getWorkerConnection() {
  return { ...parseRedisUrl(redisUrl()), maxRetriesPerRequest: null as null }
}

let queue: Queue<MemberCreateJobData | WelcomeSendJobData> | null = null

export function getIntegrationInboundQueue(): Queue<MemberCreateJobData | WelcomeSendJobData> {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getProducerConnection() })
  }
  return queue
}

// I-6: `member-create` job data carries phone/name/metadata (the
// normalised request body -- see this file's own header), unlike
// `welcome-send`'s ids-only payload. Left at the same 7-day
// `removeOnFail` retention as welcome-send, that's a week of partner-
// submitted PII sitting in Redis's failed set on every exhausted create --
// outside the Postgres RLS/audit story, and unnecessary: the
// `integration_member_jobs` row already carries everything ops needs for
// triage (phone_last4, error code). 1 hour is enough to catch a failure on
// the BullMQ dashboard shortly after it happens; the ops playbook (§4)
// documents this choice and the shortened window.
const MEMBER_CREATE_REMOVE_ON_FAIL = { count: 1000, age: 3600 }

export async function addMemberCreateJob(data: MemberCreateJobData): Promise<void> {
  const q = getIntegrationInboundQueue()
  await q.add('member-create', data, {
    jobId: data.jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 500, age: 3600 },
    removeOnFail: MEMBER_CREATE_REMOVE_ON_FAIL,
  })
}

export async function addWelcomeSendJob(jobId: string, data: WelcomeSendJobData): Promise<void> {
  const q = getIntegrationInboundQueue()
  await q.add('welcome-send', data, {
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500, age: 3600 },
    removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
  })
}

let worker: Worker<MemberCreateJobData | WelcomeSendJobData> | null = null

export function inboundConcurrencyFromEnv(): number {
  const raw = process.env.INT001_INBOUND_CONCURRENCY
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : 4
}

export function ensureWorkerStarted(): void {
  if (worker) return
  // Dynamic import (mirrors event-dispatch-queue.ts's own convention):
  // process-member-create-job.ts eventually needs `addWelcomeSendJob` from
  // THIS file, so a static top-level import of the processor here would be
  // a circular module dependency. Deferring the import to worker-start time
  // (not per-job) breaks the cycle at load time without any per-job cost.
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { integrationInboundProcessor } = await import('./integration-inbound-processor')
      return integrationInboundProcessor(job)
    },
    {
      connection: getWorkerConnection(),
      concurrency: inboundConcurrencyFromEnv(),
      limiter: { max: 50, duration: 1000 },
    }
  )
  worker.on('failed', (job, err) => {
    console.error(`[IntegrationInboundQueue] Job ${job?.id} (${job?.name}) failed:`, err.message)
  })
  console.log('[IntegrationInboundQueue] Worker started')
}

export function getWorker(): Worker<MemberCreateJobData | WelcomeSendJobData> | null {
  return worker
}

let rateLimiterClient: Redis | null = null
let rateLimiter: RedisRateLimiter | null = null

/** Shared `RateLimiterPort` for the whole inbound pipeline (auth guard +
 * per-integration depth counter). Lazily constructed so importing this
 * module never opens a Redis connection at build/import time. */
export function getInboundRateLimiter(): RedisRateLimiter {
  if (!rateLimiter) {
    rateLimiterClient = new Redis(getFailFastRedisOptions())
    rateLimiterClient.on('error', (err) => {
      console.error('[IntegrationInboundQueue] rate-limiter Redis error:', err.message)
    })
    rateLimiter = new RedisRateLimiter(rateLimiterClient)
  }
  return rateLimiter
}

export function getInboundQueueDepthSource(): QueueDepthSource {
  return {
    getDepth: async () => {
      const q = getIntegrationInboundQueue()
      const [waiting, delayed] = await Promise.all([q.getWaitingCount(), q.getDelayedCount()])
      return waiting + delayed
    },
  }
}

let globalCeilingGuard: GlobalQueueCeilingGuard | null = null

/** Shared `GlobalQueueCeilingGuard` (T-M7) -- ONE instance across requests
 * so its 1s in-process cache actually amortises concurrent traffic, rather
 * than every request re-querying BullMQ's waiting+delayed counts. */
export function getGlobalCeilingGuard(): GlobalQueueCeilingGuard {
  if (!globalCeilingGuard) {
    globalCeilingGuard = new GlobalQueueCeilingGuard(getInboundQueueDepthSource(), systemClock, globalQueueCeilingFromEnv())
  }
  return globalCeilingGuard
}
