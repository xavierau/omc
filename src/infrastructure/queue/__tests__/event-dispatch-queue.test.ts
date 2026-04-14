import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAdd = vi.fn().mockResolvedValue(undefined)

class MockQueue {
  add = mockAdd
}

class MockWorker {
  on = vi.fn()
}

vi.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
}))

vi.mock('@/infrastructure/event-dispatch/listener-registry', () => ({
  resolveListener: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/event-repository', () => ({
  createEvent: vi.fn(),
}))

import type { EventDispatchJobData } from '../event-dispatch-queue'

function buildJobData(
  overrides: Partial<EventDispatchJobData> = {}
): EventDispatchJobData {
  return {
    eventId: 'evt-001',
    restaurantId: 'rest-001',
    memberId: 'mem-001',
    eventType: 'order_completed',
    dataJson: { orderId: 'ord-123' },
    createdAt: '2026-04-13T00:00:00.000Z',
    listenerKey: 'loyalty-listener',
    ...overrides,
  }
}

describe('addEventDispatchJob', () => {
  beforeEach(() => {
    vi.resetModules()
    mockAdd.mockClear()
  })

  it('enqueues a job with correct data shape', async () => {
    const { addEventDispatchJob } = await import('../event-dispatch-queue')
    const jobData = buildJobData()

    await addEventDispatchJob(jobData)

    expect(mockAdd).toHaveBeenCalledOnce()
    const [, data] = mockAdd.mock.calls[0]
    expect(data).toEqual(jobData)
  })

  it('uses "dispatch-event" as the job name', async () => {
    const { addEventDispatchJob } = await import('../event-dispatch-queue')

    await addEventDispatchJob(buildJobData())

    const [jobName] = mockAdd.mock.calls[0]
    expect(jobName).toBe('dispatch-event')
  })

  it('configures 5 retry attempts with exponential backoff', async () => {
    const { addEventDispatchJob } = await import('../event-dispatch-queue')

    await addEventDispatchJob(buildJobData())

    const [, , options] = mockAdd.mock.calls[0]
    expect(options).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
    })
  })

  it('accepts null memberId', async () => {
    const { addEventDispatchJob } = await import('../event-dispatch-queue')
    const jobData = buildJobData({ memberId: null })

    await addEventDispatchJob(jobData)

    const [, data] = mockAdd.mock.calls[0]
    expect(data.memberId).toBeNull()
  })
})
