import { describe, it, expect, vi, beforeEach } from 'vitest'

// #102 Part B: (1) bound Redis job retention on the campaign-execution
// queue — unbounded failed/completed sets grew to 6,642 stuck jobs against
// one campaign in prod; (2) a campaign whose send exhausts every retry
// attempt must leave `getDueCampaigns()`'s status='active' filter (via
// `markCampaignFailed`) instead of being re-enqueued by the cron forever.

const mockAdd = vi.fn().mockResolvedValue(undefined)
const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()

class MockQueue {
  add = mockAdd
}

class MockWorker {
  on(event: string, cb: (...args: unknown[]) => unknown) {
    registeredHandlers.set(event, cb)
    return this
  }
}

vi.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
}))

vi.mock('@/application/execute-campaign', () => ({
  executeCampaign: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  markCampaignFailed: vi.fn().mockResolvedValue(true),
}))

import type { CampaignJobData } from '../campaign-queue'
import { markCampaignFailed } from '@/infrastructure/supabase/repositories/campaign-repository'

function buildJobData(overrides: Partial<CampaignJobData> = {}): CampaignJobData {
  return {
    campaignId: 'camp-001',
    restaurantId: 'rest-001',
    ...overrides,
  }
}

function buildJob(overrides: {
  data?: CampaignJobData
  attemptsMade?: number
  attempts?: number
} = {}) {
  return {
    id: 'job-1',
    data: overrides.data ?? buildJobData(),
    attemptsMade: overrides.attemptsMade ?? 3,
    opts: { attempts: overrides.attempts ?? 3 },
  }
}

describe('addCampaignJob', () => {
  beforeEach(() => {
    vi.resetModules()
    registeredHandlers.clear()
    mockAdd.mockClear()
  })

  it('configures 3 retry attempts with exponential backoff plus bounded retention', async () => {
    const { addCampaignJob } = await import('../campaign-queue')

    await addCampaignJob(buildJobData())

    const [jobName, , options] = mockAdd.mock.calls[0]
    expect(jobName).toBe('execute-campaign')
    expect(options).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    })
  })
})

describe("campaign worker 'failed' handler — terminal status (issue #102 Part B fix 2)", () => {
  beforeEach(async () => {
    vi.resetModules()
    registeredHandlers.clear()
    vi.mocked(markCampaignFailed).mockClear()
    const { ensureWorkerStarted } = await import('../campaign-queue')
    ensureWorkerStarted()
  })

  it('marks the campaign failed once attemptsMade reaches the configured attempts', async () => {
    const failedHandler = registeredHandlers.get('failed')!
    const job = buildJob({ attemptsMade: 3, attempts: 3 })
    const err = new Error('Campaign blocked: Template requires platform approval')

    failedHandler(job, err)
    // The handler dispatches the DB write fire-and-forget (dynamic import +
    // async call) — poll instead of assuming a fixed number of ticks.
    await vi.waitFor(() => {
      expect(markCampaignFailed).toHaveBeenCalledWith(
        'camp-001',
        'Campaign blocked: Template requires platform approval'
      )
    })
  })

  it('does NOT mark the campaign failed while retries remain', async () => {
    const failedHandler = registeredHandlers.get('failed')!
    const job = buildJob({ attemptsMade: 1, attempts: 3 })
    const err = new Error('flaky network')

    failedHandler(job, err)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(markCampaignFailed).not.toHaveBeenCalled()
  })

  it('defaults max attempts to 1 when job.opts.attempts is missing', async () => {
    const failedHandler = registeredHandlers.get('failed')!
    const job = {
      id: 'job-2',
      data: buildJobData({ campaignId: 'camp-002' }),
      attemptsMade: 1,
      opts: {},
    }

    failedHandler(job, new Error('boom'))

    await vi.waitFor(() => {
      expect(markCampaignFailed).toHaveBeenCalledWith('camp-002', 'boom')
    })
  })

  it('truncates an overlong error message before persisting', async () => {
    const failedHandler = registeredHandlers.get('failed')!
    const job = buildJob({ attemptsMade: 3, attempts: 3 })
    const longMessage = 'x'.repeat(2000)

    failedHandler(job, new Error(longMessage))

    await vi.waitFor(() => {
      expect(markCampaignFailed).toHaveBeenCalled()
    })
    const [, reason] = vi.mocked(markCampaignFailed).mock.calls[0]
    expect(reason.length).toBeLessThan(2000)
  })

  it('does not throw when the failed job has no data (defensive)', () => {
    const failedHandler = registeredHandlers.get('failed')!
    expect(() => failedHandler(undefined, new Error('boom'))).not.toThrow()
  })
})
