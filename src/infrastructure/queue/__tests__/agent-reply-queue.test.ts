// AGENT-001 W1: the agent-reply queue (debounce delay, one attempt, hourly purge scheduler).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const add = vi.fn()
const upsertJobScheduler = vi.fn()
vi.mock('bullmq', () => ({
  Queue: vi.fn(function Queue() {
    return { add, upsertJobScheduler }
  }),
  Worker: vi.fn(function Worker() {
    return { on: vi.fn() }
  }),
}))

import {
  AGENT_PURGE_INTERVAL_MS,
  AGENT_PURGE_SCHEDULER_ID,
  agentReplyJobId,
  dispatchAgentJob,
  enqueueAgentReply,
  ensureAgentRetentionScheduler,
} from '../agent-reply-queue'

const JOB = { restaurantId: 'rest-a', phone: '+85291234567', messageRowId: 'row-1' }

beforeEach(() => vi.clearAllMocks())

describe('agent-reply queue', () => {
  it('AC-R6 enqueues a reply job delayed debounceMs, one attempt, keyed by the stored row', async () => {
    await enqueueAgentReply(JOB, 3000)
    expect(add).toHaveBeenCalledWith('reply', JOB, expect.objectContaining({ jobId: 'agent-rest-a-row-1', delay: 3000, attempts: 1 }))
    expect(agentReplyJobId(JOB)).not.toContain(':')
  })

  it('AC-R5 registers the hourly purge job scheduler idempotently', async () => {
    await ensureAgentRetentionScheduler()
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      AGENT_PURGE_SCHEDULER_ID,
      { every: AGENT_PURGE_INTERVAL_MS },
      expect.objectContaining({ name: 'purge', data: { kind: 'purge' } })
    )
    expect(AGENT_PURGE_INTERVAL_MS).toBe(3_600_000)
  })

  it('dispatches purge and reply jobs to their handlers', async () => {
    const handlers = { reply: vi.fn(async () => 'sent'), purge: vi.fn(async () => ({ deleted: 0 })) }
    await dispatchAgentJob(handlers, { name: 'purge', data: { kind: 'purge' } })
    await dispatchAgentJob(handlers, { name: 'reply', data: JOB })
    expect(handlers.purge).toHaveBeenCalledTimes(1)
    expect(handlers.reply).toHaveBeenCalledWith(JOB)
  })
})
