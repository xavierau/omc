// ISSUE-77: contact-form email queue. Modelled directly on receipt-queue.ts
// (same parseRedisUrl / lazy Queue / ensureWorkerStarted shape) — the actual
// send + Result-to-throw translation lives in email-job-processor.ts (SRP:
// this file is BullMQ plumbing only).
//
// Producer vs worker connections are DELIBERATELY different (review finding,
// PR #106): `maxRetriesPerRequest: null` is only required on the WORKER
// connection, for its blocking commands (BRPOPLPUSH etc.) — ioredis must
// never give up mid-block. On the PRODUCER (Queue) connection it means the
// opposite of what the enqueue path needs: with ioredis's default
// `enableOfflineQueue: true`, a `q.add()` issued while Redis is down or
// still connecting gets silently QUEUED waiting for a reconnect that
// `maxRetriesPerRequest: null` allows to retry forever — so the webhook's
// `await addEmailJob(...)` never rejects, and the never-throw fallback in
// contact-form-handler.ts's catch block is unreachable. The producer
// connection below fails fast instead (`enableOfflineQueue: false` + a
// finite `maxRetriesPerRequest` + a bounded `connectTimeout`), and
// `addEmailJob` races a timeout on top as belt-and-braces. receipt-queue.ts
// shares one connection shape for both producer and worker (the same latent
// hang) — pre-existing there and out of scope for this fix.
import { Queue, Worker } from 'bullmq'
import type { ContactFormSubmission } from '@/domain/services/contact-email'
import { processEmailJob, handleExhaustedRetries } from './email-job-processor'

const QUEUE_NAME = 'email-send'
const ENQUEUE_TIMEOUT_MS = 5000

export interface EmailJobData {
  restaurantId: string
  notificationEmail: string
  submission: ContactFormSubmission
  senderWaId: string
  contactName: string | undefined
  messageId: string
  submittedAt: string
}

function parseRedisUrl(url: string) {
  const parsed = new URL(url)
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.pathname && parsed.pathname !== '/' ? { db: parseInt(parsed.pathname.slice(1), 10) } : {}),
  }
}

function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379'
}

/** Required for the worker's blocking commands — see file header. */
function getWorkerRedisConnection() {
  return { ...parseRedisUrl(redisUrl()), maxRetriesPerRequest: null as null }
}

/** Fail fast instead of hanging — see file header. */
function getProducerRedisConnection() {
  return {
    ...parseRedisUrl(redisUrl()),
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
  }
}

let queue: Queue<EmailJobData> | null = null

function getEmailQueue(): Queue<EmailJobData> {
  if (!queue) {
    queue = new Queue<EmailJobData>(QUEUE_NAME, {
      connection: getProducerRedisConnection(),
    })
  }
  return queue
}

/** Belt-and-braces bound on top of the fail-fast connection options above —
 * `addEmailJob` must never hold the webhook response open indefinitely. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

export async function addEmailJob(data: EmailJobData): Promise<void> {
  const q = getEmailQueue()
  await withTimeout(
    q.add('send-email', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      // PII (submission content) shouldn't sit in Redis indefinitely at low
      // failure volume just because the count cap hasn't been reached.
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
      jobId: data.messageId,
    }),
    ENQUEUE_TIMEOUT_MS,
    `email enqueue timed out after ${ENQUEUE_TIMEOUT_MS}ms`
  )
}

function createWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(
    QUEUE_NAME,
    async (job) => processEmailJob(job.data),
    { connection: getWorkerRedisConnection(), concurrency: 3 },
  )

  worker.on('completed', (job) => {
    console.log(`[EmailQueue] Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(
      `[EmailQueue] Job ${job?.id} failed:`,
      err.message
    )
    if (job) {
      handleExhaustedRetries(job, err).catch((e) =>
        console.error('[EmailQueue] Error handling exhausted retries:', e)
      )
    }
  })

  return worker
}

let worker: Worker<EmailJobData> | null = null

export function ensureWorkerStarted(): void {
  if (!worker) {
    worker = createWorker()
    console.log('[EmailQueue] Worker started')
  }
}

export function getWorker(): Worker<EmailJobData> | null {
  return worker
}

// Worker must be started explicitly in a long-running process,
// not at module level (incompatible with serverless environments)
