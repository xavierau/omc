import { Queue, Worker } from 'bullmq'
import { processReceipt } from '@/application/process-receipt'

const QUEUE_NAME = 'receipt-processing'

export interface ReceiptJobData {
  restaurantId: string
  memberId: string
  phone: string
  imageUrl: string
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

let queue: Queue<ReceiptJobData> | null = null

export function getReceiptQueue(): Queue<ReceiptJobData> {
  if (!queue) {
    queue = new Queue<ReceiptJobData>(QUEUE_NAME, {
      connection: getRedisConnection(),
    })
  }
  return queue
}

export async function addReceiptJob(
  data: ReceiptJobData
): Promise<void> {
  const q = getReceiptQueue()
  await q.add('process-receipt', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  })
}

function createWorker(): Worker<ReceiptJobData> {
  const worker = new Worker<ReceiptJobData>(
    QUEUE_NAME,
    async (job) => {
      const { restaurantId, memberId, phone, imageUrl } = job.data
      await processReceipt(restaurantId, memberId, phone, imageUrl)
    },
    { connection: getRedisConnection(), concurrency: 3 },
  )

  worker.on('completed', (job) => {
    console.log(`[ReceiptQueue] Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(
      `[ReceiptQueue] Job ${job?.id} failed:`,
      err.message
    )
  })

  return worker
}

let worker: Worker<ReceiptJobData> | null = null

export function ensureWorkerStarted(): void {
  if (!worker) {
    worker = createWorker()
    console.log('[ReceiptQueue] Worker started')
  }
}

export function getWorker(): Worker<ReceiptJobData> | null {
  return worker
}

// Worker must be started explicitly in a long-running process,
// not at module level (incompatible with serverless environments)
