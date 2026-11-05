// INT-001 WI-14 (C-2 regression): a true end-to-end reproduction of the
// resume-after-breaker-trip bug against REAL BullMQ + Redis (no mocks) --
// the queue-level unit tests in integration-outbound-queue.test.ts prove
// `addRelayDeliverJob`'s remove-then-add logic in isolation; this file
// proves the actual BullMQ dedup behaviour it exists to work around.
//
// Gated on INT001_TEST_REDIS_URL (integration lane) -- skipped entirely in
// CI, matching every other real-adapter lane in this plan (WI-1's Redis/
// scratch-DB precedent, redis-rate-limiter.test.ts's own header).
//
// Scenario (kanban INT-001 CONSTRAINT (b) / spec US-9): a delivery's worker
// function resolves the "paused" branch NORMALLY (kill switch / breaker
// trip) -- BullMQ records that job as `completed`, not removed until
// removeOnComplete's window. The row is later resumed (`paused -> queued,
// enqueued_at NULL`) and the relay re-adds it under the SAME job id.
//   - CONTROL (`addDeliverJob`, the pre-fix relay call): BullMQ dedups the
//     add() against the stale completed job -- no new job is created, the
//     worker never runs a second time.
//   - FIX (`addRelayDeliverJob`): the stale completed job is removed first,
//     so the re-add creates a real job the worker actually processes.

import { describe, expect, it, afterEach, vi } from 'vitest'
import { Worker } from 'bullmq'
import { parseRedisUrl } from '@/infrastructure/redis/connection'

const REDIS_URL = process.env.INT001_TEST_REDIS_URL
const describeIfRedis = REDIS_URL ? describe : describe.skip

function workerConnection() {
  return { ...parseRedisUrl(REDIS_URL as string), maxRetriesPerRequest: null as null }
}

/** Poll until `check()` returns true or `timeoutMs` elapses. */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error('waitUntil: timed out')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

describeIfRedis('C-2 real BullMQ+Redis: resume after a completed-as-paused job', () => {
  const workers: Worker[] = []

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((w) => w.close()))
    process.env.REDIS_URL = undefined
    delete process.env.REDIS_URL
  })

  it('CONTROL -- plain addDeliverJob (pre-fix relay call) dedupes against a stale completed job and the worker never runs a second time', async () => {
    process.env.REDIS_URL = REDIS_URL
    vi.resetModules()
    const { addDeliverJob, _resetOutboundQueueForTests, getOutboundQueue } = await import('../integration-outbound-queue')
    _resetOutboundQueueForTests()
    const deliveryId = `c2-control-${Math.random().toString(36).slice(2)}`

    let runCount = 0
    const worker = new Worker(
      'integration-outbound',
      async () => {
        runCount += 1
        // Simulates the "paused" branch: the worker fn resolves normally,
        // so BullMQ marks the job `completed`.
        return undefined
      },
      { connection: workerConnection(), concurrency: 1 }
    )
    workers.push(worker)

    try {
      await addDeliverJob(deliveryId)
      await waitUntil(async () => runCount === 1)
      await waitUntil(async () => {
        const job = await getOutboundQueue().getJob(deliveryId)
        return job !== undefined && (await job.getState()) === 'completed'
      })

      // Resume: the relay re-adds under the SAME job id via the OLD,
      // buggy call path.
      await addDeliverJob(deliveryId)
      // Give the worker a moment -- if a new job were created it would run
      // near-instantly; this is a bounded wait for a negative assertion.
      await new Promise((r) => setTimeout(r, 300))

      expect(runCount).toBe(1) // the bug: the second attempt never ran
    } finally {
      const q = getOutboundQueue()
      await q.obliterate({ force: true }).catch(() => {})
    }
  }, 15000)

  it('FIX -- addRelayDeliverJob removes the stale completed job first, so the resumed delivery actually runs again', async () => {
    process.env.REDIS_URL = REDIS_URL
    vi.resetModules()
    const { addDeliverJob, addRelayDeliverJob, _resetOutboundQueueForTests, getOutboundQueue } = await import(
      '../integration-outbound-queue'
    )
    _resetOutboundQueueForTests()
    const deliveryId = `c2-fix-${Math.random().toString(36).slice(2)}`

    let runCount = 0
    const worker = new Worker(
      'integration-outbound',
      async () => {
        runCount += 1
        return undefined
      },
      { connection: workerConnection(), concurrency: 1 }
    )
    workers.push(worker)

    try {
      await addDeliverJob(deliveryId)
      await waitUntil(async () => runCount === 1)
      await waitUntil(async () => {
        const job = await getOutboundQueue().getJob(deliveryId)
        return job !== undefined && (await job.getState()) === 'completed'
      })

      // Resume: the relay re-adds under the SAME job id via the FIXED call.
      await addRelayDeliverJob(deliveryId)
      await waitUntil(async () => runCount === 2)

      expect(runCount).toBe(2) // fixed: the resumed delivery actually ran
    } finally {
      const q = getOutboundQueue()
      await q.obliterate({ force: true }).catch(() => {})
    }
  }, 15000)
})
