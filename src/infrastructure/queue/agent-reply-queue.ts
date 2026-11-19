/**
 * AGENT-001: the `agent-reply` queue (modelled on receipt-queue.ts).
 *
 * - `reply` jobs: one per stored diner text, delayed `debounceMs`; the
 *   processor drops a job a newer message superseded (latest-wins). One
 *   attempt only: a retry could send the diner a second reply.
 * - `purge` job: an hourly job scheduler (as integration-outbound-queue.ts)
 *   running the retention purge (R5). `upsertJobScheduler` is idempotent, so
 *   registering it on every worker start never duplicates it.
 *
 * The processors are injected by the worker's composition root
 * (scripts/start-worker.ts); this module knows only BullMQ.
 */
import { Queue, Worker, type Job } from 'bullmq'
import { parseRedisUrl, redisUrl } from '@/infrastructure/redis/connection'
import type { AgentReplyJob } from '@/application/agent/admit-inbound-for-agent'

export const AGENT_REPLY_QUEUE = 'agent-reply'
export const AGENT_PURGE_SCHEDULER_ID = 'agent-reply-retention'
export const AGENT_PURGE_INTERVAL_MS = 60 * 60_000
const CONCURRENCY = 3

type PurgeJobData = { kind: 'purge' }
type AgentQueueJobData = AgentReplyJob | PurgeJobData

export interface AgentReplyWorkerHandlers {
  reply(job: AgentReplyJob): Promise<unknown>
  purge(): Promise<unknown>
}

function getRedisConnection() {
  return { ...parseRedisUrl(redisUrl()), maxRetriesPerRequest: null as null }
}

let queue: Queue<AgentQueueJobData> | null = null

export function getAgentReplyQueue(): Queue<AgentQueueJobData> {
  if (!queue) queue = new Queue<AgentQueueJobData>(AGENT_REPLY_QUEUE, { connection: getRedisConnection() })
  return queue
}

/** Job id per stored message: a duplicate enqueue of the same row is a no-op. */
export function agentReplyJobId(job: AgentReplyJob): string {
  return `agent-${job.restaurantId}-${job.messageRowId}`
}

export async function enqueueAgentReply(job: AgentReplyJob, delayMs: number): Promise<void> {
  await getAgentReplyQueue().add('reply', job, {
    jobId: agentReplyJobId(job),
    delay: delayMs,
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1000 },
  })
}

export async function ensureAgentRetentionScheduler(): Promise<void> {
  await getAgentReplyQueue().upsertJobScheduler(
    AGENT_PURGE_SCHEDULER_ID,
    { every: AGENT_PURGE_INTERVAL_MS },
    { name: 'purge', data: { kind: 'purge' }, opts: { removeOnComplete: { count: 24 }, removeOnFail: { count: 100 } } }
  )
}

export function dispatchAgentJob(handlers: AgentReplyWorkerHandlers, job: Pick<Job<AgentQueueJobData>, 'name' | 'data'>) {
  if (job.name === 'purge') return handlers.purge()
  return handlers.reply(job.data as AgentReplyJob)
}

let worker: Worker<AgentQueueJobData> | null = null

export function ensureWorkerStarted(handlers: AgentReplyWorkerHandlers): void {
  if (worker) return
  worker = new Worker<AgentQueueJobData>(AGENT_REPLY_QUEUE, (job) => dispatchAgentJob(handlers, job), {
    connection: getRedisConnection(),
    concurrency: CONCURRENCY,
  })
  // Job ids and names only: job data holds the diner's phone (R8).
  worker.on('failed', (job, err) => {
    console.error(`[AgentReplyQueue] Job ${job?.id} (${job?.name}) failed: ${err.name}`)
  })
  console.log('[AgentReplyQueue] Worker started')
}

export function getWorker(): Worker<AgentQueueJobData> | null {
  return worker
}
