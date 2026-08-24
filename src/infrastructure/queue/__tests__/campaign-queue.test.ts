import { describe, it, expect, vi, beforeEach } from 'vitest'

// #102 Part B: (1) bound Redis job retention on the campaign-execution
// queue — unbounded failed/completed sets grew to 6,642 stuck jobs against
// one campaign in prod; (2) a campaign whose send exhausts every retry
// attempt must leave `getDueCampaigns()`'s status='active' filter (via
// `markCampaignFailed`) instead of being re-enqueued by the cron forever.

// vi.hoisted() runs before every import AND before every vi.mock factory —
// required here because `ensureWorkerStarted` below is now a real (not
// type-only) top-level import, which forces campaign-queue.ts (and its
// `import { Queue, Worker } from 'bullmq'`) to evaluate immediately. A
// plain `class MockQueue {}` declared later in the file would still be in
// its temporal dead zone at that point (import statements hoist above
// regular code), so the 'bullmq' factory below needs these pre-hoisted.
const { mockAdd, registeredHandlers, MockQueue, MockWorker } = vi.hoisted(() => {
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

  return { mockAdd, registeredHandlers, MockQueue, MockWorker }
})

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

// `ensureWorkerStarted` is imported as a real (non-type) binding, resolved
// once at file-load time — BEFORE any `vi.resetModules()` below runs — so
// the CampaignGuardrailError/NoTemplateError/WhatsAppTemplate*Error classes
// it closes over (via campaign-queue.ts's own imports) stay the SAME class
// identity the test constructs error instances from. `vi.resetModules()`
// would otherwise hand back a fresh module graph with a DIFFERENT
// CampaignGuardrailError class, breaking every `instanceof` check in
// handleFailedJob's classification (item 8) — that bit us here.
import { ensureWorkerStarted, type CampaignJobData } from '../campaign-queue'
import { markCampaignFailed } from '@/infrastructure/supabase/repositories/campaign-repository'
import { CampaignGuardrailError } from '@/application/campaign-guardrail-error'
import { NoTemplateError } from '@/application/no-template-error'
import {
  WhatsAppTemplateNotFoundError,
  WhatsAppTemplateNotApprovedError,
} from '@/application/resolve-whatsapp-template'
import { TemplateHeaderMediaMissingError } from '@/application/enforce-header-media'

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
  beforeEach(() => {
    // No vi.resetModules() here (see the import comment above): the worker
    // singleton only needs to exist once — `ensureWorkerStarted()` is
    // idempotent, and `registeredHandlers` (populated on that first call)
    // is deliberately NOT cleared, since it would never be repopulated on
    // a later no-op call.
    vi.mocked(markCampaignFailed).mockClear()
    ensureWorkerStarted()
  })

  it('marks the campaign failed once attemptsMade reaches the configured attempts', async () => {
    const failedHandler = registeredHandlers.get('failed')!
    const job = buildJob({ attemptsMade: 3, attempts: 3 })
    const err = new CampaignGuardrailError([
      "Template '5th_anniversary' requires platform approval before sending (campaign camp-001)",
    ])

    failedHandler(job, err)
    // The handler dispatches the DB write fire-and-forget (dynamic import +
    // async call) — poll instead of assuming a fixed number of ticks.
    await vi.waitFor(() => {
      expect(markCampaignFailed).toHaveBeenCalledWith('camp-001', err.message)
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
    const err = new NoTemplateError('camp-002')

    failedHandler(job, err)

    await vi.waitFor(() => {
      expect(markCampaignFailed).toHaveBeenCalledWith('camp-002', err.message)
    })
  })

  it('truncates an overlong tenant-meaningful message before persisting', async () => {
    const failedHandler = registeredHandlers.get('failed')!
    const job = buildJob({ attemptsMade: 3, attempts: 3 })
    const longViolation = 'x'.repeat(2000)

    failedHandler(job, new CampaignGuardrailError([longViolation]))

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

  // Review round 2, item 8: pass tenant-meaningful text through as-is, but
  // never store a raw infra/unexpected error message — failure_reason is a
  // tenant-visible field, and internals (stack-adjacent details, DB/API
  // error text) don't belong in it.
  describe('failure_reason wording (item 8)', () => {
    it.each([
      ['CampaignGuardrailError', () => new CampaignGuardrailError(['Daily campaign limit reached (1/1)'])],
      ['NoTemplateError', () => new NoTemplateError('camp-001')],
      ['WhatsAppTemplateNotFoundError', () => new WhatsAppTemplateNotFoundError('tpl-missing')],
      ['WhatsAppTemplateNotApprovedError', () => new WhatsAppTemplateNotApprovedError('promo_x')],
      // #127 / CAMP-007: media-header guard errors are user-actionable
      // (resubmit the template with a hosted image) — show them verbatim.
      ['TemplateHeaderMediaMissingError', () => new TemplateHeaderMediaMissingError('fifth_anniversary')],
    ] as const)('passes %s message through verbatim (tenant-meaningful)', async (_name, buildErr) => {
      const failedHandler = registeredHandlers.get('failed')!
      const job = buildJob({ attemptsMade: 3, attempts: 3 })
      const err = buildErr()

      failedHandler(job, err)

      await vi.waitFor(() => {
        expect(markCampaignFailed).toHaveBeenCalledWith('camp-001', err.message)
      })
    })

    it('stores a generic message for an infra/unexpected error instead of the raw message', async () => {
      const failedHandler = registeredHandlers.get('failed')!
      const job = buildJob({ attemptsMade: 3, attempts: 3 })
      const err = new Error('connect ECONNREFUSED 10.0.0.5:5432')

      failedHandler(job, err)

      await vi.waitFor(() => {
        expect(markCampaignFailed).toHaveBeenCalled()
      })
      const [campaignId, reason] = vi.mocked(markCampaignFailed).mock.calls[0]
      expect(campaignId).toBe('camp-001')
      expect(reason).not.toContain('ECONNREFUSED')
      expect(reason).not.toBe(err.message)
    })
  })
})
