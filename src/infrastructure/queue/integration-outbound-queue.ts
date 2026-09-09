// INT-001 WI-6: BullMQ plumbing for the `integration-outbound` queue.
// Job-processing logic lives in `integration-outbound-processor.ts` (SRP,
// same split as `email-queue.ts` / `email-job-processor.ts`).
//
// Idempotency (WI-6 Tests-first: "double run -> no duplicate jobs"): every
// `deliver` job uses `jobId = deliveryId` (first attempt) or
// `${deliveryId}:r1` (one manual retry, US-9) -- BullMQ's own dedup on a
// still-active jobId makes a second `add()` for the same delivery a no-op,
// which is what makes the 30s relay safe to re-select a row it already
// enqueued moments ago.

import { Queue } from 'bullmq'
import { parseRedisUrl, redisUrl } from '@/infrastructure/redis/connection'

export const QUEUE_NAME = 'integration-outbound'

export interface DeliverJobData {
  deliveryId: string
}

export interface SweepJobData {
  kind: 'relay' | 'maintenance'
}

export type OutboundJobData = DeliverJobData | SweepJobData

function getRedisConnection() {
  return { ...parseRedisUrl(redisUrl()), maxRetriesPerRequest: null as null }
}

let queue: Queue<OutboundJobData> | null = null

export function getOutboundQueue(): Queue<OutboundJobData> {
  if (!queue) {
    queue = new Queue<OutboundJobData>(QUEUE_NAME, { connection: getRedisConnection() })
  }
  return queue
}

// Queues table (plan): attempts 5, exponential backoff 3s (3, 6, 12, 24,
// 48s); removeOnComplete { count: 200, age: 1h }; removeOnFail { count:
// 1000, age: 7d } -- bounded exactly like event-dispatch-queue.ts (#102
// Part B: an unbounded set grew to 6,642 stuck jobs).
const ATTEMPTS = 5
const BACKOFF_DELAY_MS = 3000
const REMOVE_ON_COMPLETE = { count: 200, age: 3600 }
const REMOVE_ON_FAIL = { count: 1000, age: 7 * 24 * 3600 }

async function addDeliver(jobId: string, deliveryId: string): Promise<void> {
  await getOutboundQueue().add(
    'deliver',
    { deliveryId },
    {
      jobId,
      attempts: ATTEMPTS,
      backoff: { type: 'exponential', delay: BACKOFF_DELAY_MS },
      removeOnComplete: REMOVE_ON_COMPLETE,
      removeOnFail: REMOVE_ON_FAIL,
    }
  )
}

/** First (and only automatic-retry) attempt path -- `jobId = deliveryId`. */
export async function addDeliverJob(deliveryId: string): Promise<void> {
  await addDeliver(deliveryId, deliveryId)
}

/** US-9 manual retry, one re-attempt with a fresh attempts budget --
 * `jobId = deliveryId:r1` so it never collides with (or gets deduped
 * against) the original, already-exhausted job. */
export async function addRetryDeliverJob(deliveryId: string): Promise<void> {
  await addDeliver(`${deliveryId}:r1`, deliveryId)
}

const OUTBOUND_CONCURRENCY_DEFAULT = 2
const OUTBOUND_CONCURRENCY_HARD_MAX = 4

/** `INT001_OUTBOUND_CONCURRENCY`, default 2, hard max 4 (plan's Queues
 * table + kanban INT-001 constraint (b): "worker concurrency capped, start
 * at 2-4, configurable"). */
export function outboundConcurrencyFromEnv(): number {
  const raw = process.env.INT001_OUTBOUND_CONCURRENCY
  const n = raw ? Number(raw) : NaN
  const value = Number.isFinite(n) && n >= 1 ? n : OUTBOUND_CONCURRENCY_DEFAULT
  return Math.min(value, OUTBOUND_CONCURRENCY_HARD_MAX)
}

const RELAY_SCHEDULER_ID = 'integration-outbound-relay'
const MAINTENANCE_SCHEDULER_ID = 'integration-outbound-maintenance'
const RELAY_INTERVAL_MS = 30_000
const MAINTENANCE_INTERVAL_MS = 5 * 60_000

/** Registers the two repeatable `sweep` jobs (Integration Map row 5) --
 * idempotent to call on every worker start (`upsertJobScheduler` replaces
 * the existing scheduler definition rather than creating a duplicate). */
export async function ensureSweepSchedulersRegistered(): Promise<void> {
  const q = getOutboundQueue()
  await q.upsertJobScheduler(RELAY_SCHEDULER_ID, { every: RELAY_INTERVAL_MS }, {
    name: 'relay',
    data: { kind: 'relay' },
  })
  await q.upsertJobScheduler(MAINTENANCE_SCHEDULER_ID, { every: MAINTENANCE_INTERVAL_MS }, {
    name: 'maintenance',
    data: { kind: 'maintenance' },
  })
}

export function _resetOutboundQueueForTests(): void {
  queue = null
}
