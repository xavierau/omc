import { Queue, Worker } from 'bullmq'
import { executeCampaign } from '@/application/execute-campaign'
import { CampaignGuardrailError } from '@/application/campaign-guardrail-error'
import { NoTemplateError } from '@/application/no-template-error'
import {
  WhatsAppTemplateNotFoundError,
  WhatsAppTemplateNotApprovedError,
} from '@/application/resolve-whatsapp-template'

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
    // #102 Part B fix 1: bound Redis retention — an unbounded failed/
    // completed set grows forever (observed: 6,642 stuck jobs against one
    // campaign in prod, from a single 26-day-stuck send).
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1000 },
  })
}

// #102 Part B fix 2: a campaign whose send exhausts every configured retry
// attempt must leave getDueCampaigns()'s status='active' filter, or the
// cron re-enqueues it on every tick forever (the prod incident this issue
// diagnoses). Mirrors event-dispatch-queue.ts's handleFailedJob pattern —
// dynamic import keeps the worker module's static dependency surface thin.
const FAILURE_REASON_MAX_LEN = 500

function truncateFailureReason(message: string): string {
  if (message.length <= FAILURE_REASON_MAX_LEN) return message
  return `${message.slice(0, FAILURE_REASON_MAX_LEN)}…`
}

// Review round 2, item 8: failure_reason is a TENANT-VISIBLE field.
// Allowlist of error classes whose message is safe/meaningful to show a
// tenant verbatim; anything else (Supabase/API/network errors, stray
// throws) gets a generic message instead of leaking internals.
const GENERIC_FAILURE_REASON =
  'Campaign send failed due to an unexpected error. Contact support if this persists.'

function isTenantMeaningfulError(err: Error): boolean {
  return (
    err instanceof CampaignGuardrailError ||
    err instanceof NoTemplateError ||
    err instanceof WhatsAppTemplateNotFoundError ||
    err instanceof WhatsAppTemplateNotApprovedError
  )
}

function resolveFailureReason(err: Error): string {
  if (isTenantMeaningfulError(err)) return truncateFailureReason(err.message)
  return GENERIC_FAILURE_REASON
}

async function handleFailedJob(
  job: { data: CampaignJobData; attemptsMade: number; opts: { attempts?: number } },
  err: Error
): Promise<void> {
  const maxAttempts = job.opts.attempts ?? 1
  if (job.attemptsMade < maxAttempts) return

  const { markCampaignFailed } = await import(
    '@/infrastructure/supabase/repositories/campaign-repository'
  )
  await markCampaignFailed(job.data.campaignId, resolveFailureReason(err))
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
    if (job) {
      handleFailedJob(job, err).catch((e) =>
        console.error('[CampaignQueue] Error marking campaign failed:', e)
      )
    }
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
