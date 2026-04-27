import { Queue, Worker } from 'bullmq'
import { executeCampaign } from '@/application/execute-campaign'

const QUEUE_NAME = 'campaign-execution'

export interface CampaignJobData {
  campaignId: string
  restaurantId: string
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

let queue: Queue<CampaignJobData> | null = null

function getCampaignQueue(): Queue<CampaignJobData> {
  if (!queue) {
    queue = new Queue<CampaignJobData>(QUEUE_NAME, {
      connection: getRedisConnection(),
    })
  }
  return queue
}

export async function addCampaignJob(
  data: CampaignJobData
): Promise<void> {
  const q = getCampaignQueue()
  await q.add('execute-campaign', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  })
}

function createWorker(): Worker<CampaignJobData> {
  const worker = new Worker<CampaignJobData>(
    QUEUE_NAME,
    async (job) => {
      const { campaignId, restaurantId } = job.data
      await executeCampaign(campaignId, restaurantId)
    },
    { connection: getRedisConnection(), concurrency: 1 },
  )

  worker.on('completed', (job) => {
    console.log(`[CampaignQueue] Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(
      `[CampaignQueue] Job ${job?.id} failed:`,
      err.message
    )
  })

  return worker
}

let worker: Worker<CampaignJobData> | null = null

export function ensureWorkerStarted(): void {
  if (!worker) {
    worker = createWorker()
    console.log('[CampaignQueue] Worker started')
  }
}

export function getWorker(): Worker<CampaignJobData> | null {
  return worker
}

// Worker must be started explicitly in a long-running process,
// not at module level (incompatible with serverless environments)
