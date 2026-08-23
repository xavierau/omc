// ISSUE-77: contact-form email queue. Modelled directly on receipt-queue.ts
// (same parseRedisUrl / lazy Queue / ensureWorkerStarted shape) — the actual
// send + Result-to-throw translation lives in email-job-processor.ts (SRP:
// this file is BullMQ plumbing only).
import { Queue, Worker } from 'bullmq'
import type { ContactFormSubmission } from '@/domain/services/contact-email'
import { processEmailJob, handleExhaustedRetries } from './email-job-processor'

const QUEUE_NAME = 'email-send'

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
    maxRetriesPerRequest: null as null,
  }
}

function getRedisConnection() {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  return parseRedisUrl(url)
}

let queue: Queue<EmailJobData> | null = null

function getEmailQueue(): Queue<EmailJobData> {
  if (!queue) {
    queue = new Queue<EmailJobData>(QUEUE_NAME, {
      connection: getRedisConnection(),
    })
  }
  return queue
}

export async function addEmailJob(data: EmailJobData): Promise<void> {
  const q = getEmailQueue()
  await q.add('send-email', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1000 },
    jobId: data.messageId,
  })
}

function createWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(
    QUEUE_NAME,
    async (job) => processEmailJob(job.data),
    { connection: getRedisConnection(), concurrency: 3 },
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
