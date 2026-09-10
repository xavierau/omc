// INT-001 WI-17 (N-2 confirmation-review finding): does the per-host
// throttle path's `job.moveToDelayed(ts, token)` at
// integration-outbound-processor.ts:83 burn the job's own BullMQ attempt
// budget, so that four-plus throttle deferrals make the FIFTH pickup
// `isFinalAttempt` and a busy host's first genuinely transient failure
// dead-letters instead of retrying (the C-1 interaction the review flagged)?
//
// Investigated against the ACTUALLY PINNED bullmq version (5.76.5,
// package-lock.json) rather than the review's general claim:
//   - `node_modules/bullmq/dist/{cjs,esm}/classes/job.js`'s public
//     `moveToDelayed(timestamp, token)` hardcodes `{ skipAttempt: true }` on
//     EVERY call, unconditionally -- there is no third parameter in this
//     version's own type signature (`job.d.ts`:
//     `moveToDelayed(timestamp: number, token?: string): Promise<void>`) to
//     pass `{ skipAttempt: true }` through even if we wanted to; it is
//     already the only behaviour the library allows.
//   - `moveToDelayed-12.lua:367-369` only runs `HINCRBY jobKey atm 1` when
//     `ARGV[6] == "0"` (skip-attempt FALSE) -- which the JS wrapper above
//     never sends.
//   - Verified live against this real Redis + real bullmq (not just read
//     from source): 10 consecutive `job.moveToDelayed()` calls left
//     `attemptsMade` at 0 throughout; a following plain `throw new
//     Error(...)` (BullMQ's own retry path, `moveToFinished` on failure --
//     the ONLY place 5.76.5 increments `atm`) brought it to 1 on the next
//     pickup, exactly once.
//
// Conclusion: N-2's prescribed fix (`{ skipAttempt: true }` on the throttle
// call) is not applicable to -- and not needed for -- the pinned bullmq
// version: `job.moveToDelayed()` already never counts an attempt, with no
// way to make it do so via the public API even by mistake. NO production
// code change was made for N-2 (integration-outbound-processor.ts:83 is
// unchanged). This file is the regression guard: it proves the acceptance
// criterion holds against the SAME real BullMQ + Redis stack the C-2 fix
// (integration-outbound-queue.c2-real-redis.test.ts) was proven against,
// and will FAIL if a future bullmq upgrade ever changes this default --
// which is exactly the moment a real `{ skipAttempt: true }` fix would need
// to be added back.
//
// Gated on INT001_TEST_REDIS_URL (integration lane) -- skipped entirely in
// CI, matching every other real-adapter lane in this plan.

import { describe, expect, it, afterEach } from 'vitest'
import { Queue, Worker, DelayedError, type Job } from 'bullmq'

const REDIS_URL = process.env.INT001_TEST_REDIS_URL
const describeIfRedis = REDIS_URL ? describe : describe.skip

function connection() {
  const url = new URL(REDIS_URL as string)
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    maxRetriesPerRequest: null as null,
  }
}

/** Poll until `check()` returns true or `timeoutMs` elapses. */
async function waitUntil(check: () => boolean, timeoutMs = 10000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (check()) return
    if (Date.now() > deadline) throw new Error('waitUntil: timed out')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

describeIfRedis('N-2 real BullMQ+Redis: per-host throttle deferrals never burn the attempt budget', () => {
  const queues: Queue[] = []
  const workers: Worker[] = []

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((w) => w.close()))
    await Promise.all(
      queues.splice(0).map(async (q) => {
        await q.obliterate({ force: true }).catch(() => {})
        await q.close()
      })
    )
  })

  it('10 consecutive job.moveToDelayed() throttle deferrals leave attemptsMade unchanged; a following real transient failure counts exactly 1', async () => {
    const queueName = `n2-verify-${Math.random().toString(36).slice(2)}`
    const queue = new Queue(queueName, { connection: connection() })
    queues.push(queue)
    const jobId = 'job-1'
    await queue.add('deliver', {}, { jobId, attempts: 5 })

    const seenAttemptsMade: number[] = []
    let calls = 0
    let done = false

    const worker = new Worker(
      queueName,
      async (job: Job, token?: string) => {
        calls += 1
        seenAttemptsMade.push(job.attemptsMade)
        if (calls <= 10) {
          // The exact call this file exists to verify: the SAME shape as
          // integration-outbound-processor.ts:83's throttle path.
          await job.moveToDelayed(Date.now() + 25, token)
          throw new DelayedError()
        }
        if (calls === 11) {
          // "a following transient failure" -- ordinary BullMQ retry path,
          // the SAME shape as integration-outbound-processor.ts:106.
          throw new Error('simulated transient failure')
        }
        done = true
        return undefined
      },
      { connection: connection(), concurrency: 1 }
    )
    workers.push(worker)

    await waitUntil(() => done, 15000)

    // Calls 1-10 (the throttle deferrals): attemptsMade must stay 0.
    expect(seenAttemptsMade.slice(0, 10).every((n) => n === 0)).toBe(true)
    // Call 11 (the first REAL attempt, per integration-outbound-processor.ts's
    // own `attemptNumber = job.attemptsMade + 1` -- must be attempt 1, i.e.
    // attemptsMade still 0 going in): confirms the throttle deferrals truly
    // never consumed the budget.
    expect(seenAttemptsMade[10]).toBe(0)
    // Call 12 (BullMQ's own retry after the real failure): exactly ONE
    // attempt counted, not eleven.
    expect(seenAttemptsMade[11]).toBe(1)
  }, 20000)
})
