import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAdd = vi.fn().mockResolvedValue(undefined)
const mockOn = vi.fn()
let capturedProcessor: ((job: { data: unknown }) => Promise<void>) | undefined

class MockQueue {
  add = mockAdd
}

class MockWorker {
  on = mockOn
  constructor(_name: string, processor: (job: { data: unknown }) => Promise<void>) {
    capturedProcessor = processor
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

  it('configures 3 retry attempts with exponential backoff, retention, and messageId dedupe', async () => {
    const { addEmailJob } = await import('../email-queue')
    const jobData = buildJobData({ messageId: 'wamid.dedupe-key' })

    await addEmailJob(jobData)

    const [, , options] = mockAdd.mock.calls[0]
    expect(options).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
      jobId: 'wamid.dedupe-key',
    })
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
