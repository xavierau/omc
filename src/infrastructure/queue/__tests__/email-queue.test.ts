import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockAdd = vi.fn().mockResolvedValue(undefined)
const mockOn = vi.fn()
let capturedProcessor: ((job: { data: unknown }) => Promise<void>) | undefined
let capturedQueueConnection: Record<string, unknown> | undefined
let capturedWorkerConnection: Record<string, unknown> | undefined

class MockQueue {
  add = mockAdd
  constructor(_name: string, opts: { connection: Record<string, unknown> }) {
    capturedQueueConnection = opts.connection
  }
}

class MockWorker {
  on = mockOn
  constructor(
    _name: string,
    processor: (job: { data: unknown }) => Promise<void>,
    opts: { connection: Record<string, unknown> }
  ) {
    capturedProcessor = processor
    capturedWorkerConnection = opts.connection
  }
}

vi.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
}))

const processEmailJob = vi.fn().mockResolvedValue(undefined)
const handleExhaustedRetries = vi.fn().mockResolvedValue(undefined)
vi.mock('../email-job-processor', () => ({
  processEmailJob: (...args: unknown[]) => processEmailJob(...args),
  handleExhaustedRetries: (...args: unknown[]) => handleExhaustedRetries(...args),
}))

import type { EmailJobData } from '../email-queue'

function buildJobData(overrides: Partial<EmailJobData> = {}): EmailJobData {
  return {
    restaurantId: 'r-1',
    notificationEmail: 'owner@example.com',
    submission: { clientName: 'Alice', clientWhatsapp: '85291234567', topic: '訂座查詢' },
    senderWaId: '85291234567',
    contactName: 'Alice Chan',
    messageId: 'wamid.001',
    submittedAt: '2026-01-01T03:00:00.000Z',
    ...overrides,
  }
}

describe('addEmailJob', () => {
  beforeEach(() => {
    vi.resetModules()
    mockAdd.mockClear()
    mockAdd.mockResolvedValue(undefined)
    capturedQueueConnection = undefined
    capturedWorkerConnection = undefined
  })

  it('enqueues a job with correct data shape', async () => {
    const { addEmailJob } = await import('../email-queue')
    const jobData = buildJobData()

    await addEmailJob(jobData)

    expect(mockAdd).toHaveBeenCalledOnce()
    const [, data] = mockAdd.mock.calls[0]
    expect(data).toEqual(jobData)
  })

  it('uses "send-email" as the job name', async () => {
    const { addEmailJob } = await import('../email-queue')

    await addEmailJob(buildJobData())

    const [jobName] = mockAdd.mock.calls[0]
    expect(jobName).toBe('send-email')
  })

  it('configures 3 retry attempts with exponential backoff, bounded retention, and messageId dedupe', async () => {
    const { addEmailJob } = await import('../email-queue')
    const jobData = buildJobData({ messageId: 'wamid.dedupe-key' })

    await addEmailJob(jobData)

    const [, , options] = mockAdd.mock.calls[0]
    expect(options).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      // Age-bounded: failed jobs carry submission PII and must not sit in
      // Redis indefinitely at low failure volume just because the count cap
      // (1000) hasn't been hit (PR #106 review finding).
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
      jobId: 'wamid.dedupe-key',
    })
  })

  it('constructs the producer (Queue) connection to fail fast instead of queueing offline', async () => {
    const { addEmailJob } = await import('../email-queue')
    await addEmailJob(buildJobData())

    expect(capturedQueueConnection).toMatchObject({
      enableOfflineQueue: false,
      connectTimeout: expect.any(Number),
    })
    // Finite — NOT null. null (the worker's setting) means "retry forever",
    // which is exactly the hang this connection must avoid.
    expect(capturedQueueConnection?.maxRetriesPerRequest).not.toBeNull()
    expect(typeof capturedQueueConnection?.maxRetriesPerRequest).toBe('number')
  })

  it('keeps maxRetriesPerRequest: null on the worker connection (required for blocking commands)', async () => {
    const { ensureWorkerStarted } = await import('../email-queue')

    ensureWorkerStarted()

    expect(capturedWorkerConnection?.maxRetriesPerRequest).toBeNull()
  })
})

describe('addEmailJob — bounded against a hang (not just a rejection)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockAdd.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects within the enqueue timeout when the underlying add() never resolves', async () => {
    // Simulates the real failure mode a mocked rejection can't: Redis
    // unreachable + an offline/blackholed connection means the ioredis
    // command promise never settles at all, not that it rejects promptly.
    mockAdd.mockReturnValue(new Promise(() => {}))
    const { addEmailJob } = await import('../email-queue')

    const result = addEmailJob(buildJobData())
    const assertion = expect(result).rejects.toThrow(/timed out/)

    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })

  it('does not wait the full timeout when add() resolves quickly', async () => {
    mockAdd.mockResolvedValue(undefined)
    const { addEmailJob } = await import('../email-queue')

    await expect(addEmailJob(buildJobData())).resolves.toBeUndefined()
  })
})

describe('worker wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    mockOn.mockClear()
    processEmailJob.mockClear()
    handleExhaustedRetries.mockClear()
    capturedProcessor = undefined
  })

  it('ensureWorkerStarted creates a worker whose processor delegates to processEmailJob', async () => {
    const { ensureWorkerStarted, getWorker } = await import('../email-queue')

    ensureWorkerStarted()

    expect(getWorker()).not.toBeNull()
    expect(capturedProcessor).toBeDefined()

    const jobData = buildJobData()
    await capturedProcessor!({ data: jobData })
    expect(processEmailJob).toHaveBeenCalledWith(jobData)
  })

  it('is idempotent — a second call does not create a second worker', async () => {
    const { ensureWorkerStarted, getWorker } = await import('../email-queue')

    ensureWorkerStarted()
    const first = getWorker()
    ensureWorkerStarted()

    expect(getWorker()).toBe(first)
  })

  it('registers a "failed" listener that delegates to handleExhaustedRetries', async () => {
    const { ensureWorkerStarted } = await import('../email-queue')

    ensureWorkerStarted()

    const failedCall = mockOn.mock.calls.find(([event]) => event === 'failed')
    expect(failedCall).toBeDefined()
    const [, failedHandler] = failedCall!
    const job = { data: buildJobData(), attemptsMade: 3, opts: { attempts: 3 } }
    const err = new Error('boom')

    failedHandler(job, err)
    await Promise.resolve()

    expect(handleExhaustedRetries).toHaveBeenCalledWith(job, err)
  })
})
