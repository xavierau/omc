import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockAdd, mockUpsertJobScheduler, mockGetJob, MockQueue } = vi.hoisted(() => {
  const mockAdd = vi.fn().mockResolvedValue(undefined)
  const mockUpsertJobScheduler = vi.fn().mockResolvedValue(undefined)
  const mockGetJob = vi.fn().mockResolvedValue(undefined)

  class MockQueue {
    add = mockAdd
    upsertJobScheduler = mockUpsertJobScheduler
    getJob = mockGetJob
  }

  return { mockAdd, mockUpsertJobScheduler, mockGetJob, MockQueue }
})

vi.mock('bullmq', () => ({ Queue: MockQueue }))

import {
  addDeliverJob,
  addRelayDeliverJob,
  addRetryDeliverJob,
  ensureSweepSchedulersRegistered,
  outboundConcurrencyFromEnv,
  _resetOutboundQueueForTests,
} from '../integration-outbound-queue'

const ORIGINAL_CONCURRENCY = process.env.INT001_OUTBOUND_CONCURRENCY

describe('addDeliverJob (WI-6 Tests-first: job payload contains only ids)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetOutboundQueueForTests()
  })

  it('uses jobId = deliveryId, and the job data contains ONLY the delivery id -- no phone/name anywhere in it', async () => {
    await addDeliverJob('del-1')

    expect(mockAdd).toHaveBeenCalledTimes(1)
    const [name, data, opts] = mockAdd.mock.calls[0] as [string, Record<string, unknown>, Record<string, unknown>]
    expect(name).toBe('deliver')
    expect(data).toEqual({ deliveryId: 'del-1' })

    // Structural check (T-H7): walk the JSON-serialised job data and assert
    // no key/value anywhere looks like PII -- not just "we didn't add a
    // `phone` field today", but "nothing in this payload could carry it".
    const serialised = JSON.stringify(data)
    expect(Object.keys(data)).toEqual(['deliveryId'])
    expect(serialised).not.toMatch(/phone|name|\+\d{8,}/i)

    expect(opts).toMatchObject({
      jobId: 'del-1',
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { count: 200, age: 3600 },
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    })
  })

  it('addDeliverJob called twice with the same deliveryId uses the SAME jobId both times (BullMQ-level idempotency)', async () => {
    await addDeliverJob('del-1')
    await addDeliverJob('del-1')

    expect(mockAdd).toHaveBeenCalledTimes(2)
    const jobIds = mockAdd.mock.calls.map((call) => (call[2] as { jobId: string }).jobId)
    expect(jobIds).toEqual(['del-1', 'del-1'])
  })
})

describe('addRetryDeliverJob (US-9 manual retry)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetOutboundQueueForTests()
  })

  it('uses jobId = `${deliveryId}:r1`, distinct from the original attempt', async () => {
    await addRetryDeliverJob('del-1')
    const opts = mockAdd.mock.calls[0][2] as { jobId: string }
    expect(opts.jobId).toBe('del-1:r1')
  })
})

describe('addRelayDeliverJob (C-2: relay/resume re-enqueue does not dedupe against a stale completed/failed job)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetOutboundQueueForTests()
  })

  it('no existing job for this id -> adds with jobId = deliveryId, same as addDeliverJob', async () => {
    mockGetJob.mockResolvedValue(undefined)

    await addRelayDeliverJob('del-1')

    expect(mockGetJob).toHaveBeenCalledWith('del-1')
    expect(mockAdd).toHaveBeenCalledTimes(1)
    const opts = mockAdd.mock.calls[0][2] as { jobId: string }
    expect(opts.jobId).toBe('del-1')
  })

  it('C-2 regression: an existing job that already COMPLETED (the paused-branch resolves the worker fn normally, so BullMQ records it as completed) is removed before re-adding -- otherwise BullMQ dedupes the add() into a no-op and the row is marked enqueued for a job that was never created', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    mockGetJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('completed'), remove })

    await addRelayDeliverJob('del-1')

    expect(remove).toHaveBeenCalledTimes(1)
    expect(mockAdd).toHaveBeenCalledTimes(1)
    const opts = mockAdd.mock.calls[0][2] as { jobId: string }
    expect(opts.jobId).toBe('del-1')
  })

  it('an existing job that already FAILED (exhausted BullMQ retries) is also removed before re-adding', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    mockGetJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('failed'), remove })

    await addRelayDeliverJob('del-1')

    expect(remove).toHaveBeenCalledTimes(1)
    expect(mockAdd).toHaveBeenCalledTimes(1)
  })

  it('an existing job still ACTIVE/WAITING/DELAYED (a genuinely in-flight enqueue) is left alone -- add() dedupes against it exactly as addDeliverJob always has', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    mockGetJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('active'), remove })

    await addRelayDeliverJob('del-1')

    expect(remove).not.toHaveBeenCalled()
    expect(mockAdd).toHaveBeenCalledTimes(1)
    const opts = mockAdd.mock.calls[0][2] as { jobId: string }
    expect(opts.jobId).toBe('del-1')
  })
})

describe('ensureSweepSchedulersRegistered', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetOutboundQueueForTests()
  })

  it('registers both a 30s relay scheduler and a 5min maintenance scheduler', async () => {
    await ensureSweepSchedulersRegistered()

    expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(2)
    const [relayId, relayOpts, relayTemplate] = mockUpsertJobScheduler.mock.calls[0] as [
      string,
      { every: number },
      { name: string }
    ]
    expect(relayOpts.every).toBe(30_000)
    expect(relayTemplate.name).toBe('relay')

    const [maintId, maintOpts, maintTemplate] = mockUpsertJobScheduler.mock.calls[1] as [
      string,
      { every: number },
      { name: string }
    ]
    expect(maintOpts.every).toBe(300_000)
    expect(maintTemplate.name).toBe('maintenance')
    expect(relayId).not.toBe(maintId)
  })
})

describe('outboundConcurrencyFromEnv', () => {
  afterEach(() => {
    if (ORIGINAL_CONCURRENCY === undefined) delete process.env.INT001_OUTBOUND_CONCURRENCY
    else process.env.INT001_OUTBOUND_CONCURRENCY = ORIGINAL_CONCURRENCY
  })

  it('defaults to 2', () => {
    delete process.env.INT001_OUTBOUND_CONCURRENCY
    expect(outboundConcurrencyFromEnv()).toBe(2)
  })

  it('honours a configured value up to the hard max of 4', () => {
    process.env.INT001_OUTBOUND_CONCURRENCY = '3'
    expect(outboundConcurrencyFromEnv()).toBe(3)
  })

  it('caps a configured value above 4 at the hard max', () => {
    process.env.INT001_OUTBOUND_CONCURRENCY = '99'
    expect(outboundConcurrencyFromEnv()).toBe(4)
  })

  it('falls back to the default on a non-numeric value', () => {
    process.env.INT001_OUTBOUND_CONCURRENCY = 'nope'
    expect(outboundConcurrencyFromEnv()).toBe(2)
  })
})
