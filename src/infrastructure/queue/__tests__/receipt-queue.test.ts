import { describe, it, expect, vi, beforeEach } from 'vitest'

// #102 Part B fix 1: bound Redis job retention. `addReceiptJob` set
// `attempts`/`backoff` but no `removeOnComplete`/`removeOnFail`, so every
// completed/failed job accumulated in Redis forever (same defect as
// campaign-queue.ts, fixed for that queue in the same issue).

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

vi.mock('@/application/process-receipt', () => ({
  processReceipt: vi.fn(),
}))

import type { ReceiptJobData } from '../receipt-queue'

function buildJobData(overrides: Partial<ReceiptJobData> = {}): ReceiptJobData {
  return {
    restaurantId: 'rest-001',
    memberId: 'mem-001',
    phone: '85291234567',
    imageUrl: 'https://cdn.test/receipt.jpg',
    ...overrides,
  }
}

describe('addReceiptJob', () => {
  beforeEach(() => {
    vi.resetModules()
    mockAdd.mockClear()
  })

  it('configures 3 retry attempts with exponential backoff plus bounded retention', async () => {
    const { addReceiptJob } = await import('../receipt-queue')

    await addReceiptJob(buildJobData())

    const [, , options] = mockAdd.mock.calls[0]
    expect(options).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    })
  })
})
