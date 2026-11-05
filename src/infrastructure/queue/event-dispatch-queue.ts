import { Queue, Worker } from 'bullmq'
import type { DomainEvent } from '@/domain/ports/event-listener'
import type { EventType } from '@/domain/entities/event'

const QUEUE_NAME = 'event-dispatch'

export interface EventDispatchJobData {
  eventId: string
  restaurantId: string
  memberId: string | null
  eventType: string
  dataJson: Record<string, unknown>
  createdAt: string
  listenerKey: string
  source?: string | null
}

function parseRedisUrl(url: string) {
  const parsed = new URL(url)
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.pathname && parsed.pathname !== '/' ? { db: parseInt(parsed.pathname.slice(1), 10) } : {}),
    maxRetriesPerRequest: null as null,
  }
}

function getRedisConnection() {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  return parseRedisUrl(url)
}

let queue: Queue<EventDispatchJobData> | null = null

function getEventDispatchQueue(): Queue<EventDispatchJobData> {
  if (!queue) {
    queue = new Queue<EventDispatchJobData>(QUEUE_NAME, {
      connection: getRedisConnection(),
    })
  }
  return queue
}

export async function addEventDispatchJob(
  data: EventDispatchJobData
): Promise<void> {
  const q = getEventDispatchQueue()
  await q.add('dispatch-event', data, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 3000 },
    // #102 Part B fix 1: bound Redis retention — an unbounded failed/
    // completed set grows forever (observed: 6,642 stuck jobs on the
    // sibling campaign-execution queue).
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1000 },
  })
}

function buildDomainEvent(data: EventDispatchJobData): DomainEvent {
  return {
    id: data.eventId,
    restaurantId: data.restaurantId,
    memberId: data.memberId,
    type: data.eventType as EventType,
    dataJson: data.dataJson,
    createdAt: data.createdAt,
    source: data.source ?? null,
  }
}

async function handleFailedJob(
  job: { data: EventDispatchJobData; attemptsMade: number; opts: { attempts?: number } },
  err: Error
): Promise<void> {
  const maxAttempts = job.opts.attempts ?? 5
  if (job.attemptsMade < maxAttempts) return

  const { createEvent } = await import(
    '@/infrastructure/supabase/repositories/event-repository'
  )
  await createEvent({
    restaurantId: job.data.restaurantId,
    memberId: job.data.memberId,
    type: 'integration_error',
    dataJson: {
      originalEventId: job.data.eventId,
      originalEventType: job.data.eventType,
      listenerKey: job.data.listenerKey,
      error: err.message,
      attempts: job.attemptsMade,
    },
  })
}

function createWorker(): Worker<EventDispatchJobData> {
  const worker = new Worker<EventDispatchJobData>(
    QUEUE_NAME,
    async (job) => {
      const { resolveListener } = await import(
        '@/infrastructure/event-dispatch/listener-registry'
      )
      const listener = resolveListener(job.data.listenerKey)
      const event = buildDomainEvent(job.data)
      await listener.handle(event)
    },
    { connection: getRedisConnection(), concurrency: 1 },
  )

  worker.on('completed', (job) => {
    console.log(`[EventDispatchQueue] Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(
      `[EventDispatchQueue] Job ${job?.id} failed:`,
      err.message
    )
    if (job) {
      handleFailedJob(job, err).catch((e) =>
        console.error('[EventDispatchQueue] Error logging failure:', e)
      )
    }
  })

  return worker
}

let worker: Worker<EventDispatchJobData> | null = null

export function ensureWorkerStarted(): void {
  if (!worker) {
    worker = createWorker()
    console.log('[EventDispatchQueue] Worker started')
  }
}

export function getWorker(): Worker<EventDispatchJobData> | null {
  return worker
}

// Worker must be started explicitly in a long-running process,
// not at module level (incompatible with serverless environments)
