// INT-001 WI-2 T-M7: global waiting-job ceiling across every integration on
// `integration-inbound`, on top of the per-integration cap (WI-3 owns the
// per-integration `int001:depth:{integrationId}` counter). WI-2 builds the
// reusable, cached primitive; WI-3 wires it to the real BullMQ queue's
// `getWaitingCount() + getDelayedCount()` once that queue exists.
//
// Frozen acceptance-suite item covered here: "global ceiling -> 503
// queue_depth_exceeded" (exercised at the primitive level, since the real
// route does not exist until WI-3).

import { describe, expect, it } from 'vitest'
import { FakeClock } from '@/test-utils/fake-clock'
import {
  DEFAULT_GLOBAL_QUEUE_CEILING,
  GlobalQueueCeilingGuard,
  globalQueueCeilingFromEnv,
} from '../check-global-queue-ceiling'

class CountingDepthSource {
  calls = 0
  constructor(private depth: number) {}
  async getDepth(): Promise<number> {
    this.calls += 1
    return this.depth
  }
  setDepth(value: number): void {
    this.depth = value
  }
}

describe('GlobalQueueCeilingGuard', () => {
  it('reports not exceeded when depth is below the ceiling', async () => {
    const source = new CountingDepthSource(100)
    const guard = new GlobalQueueCeilingGuard(source, new FakeClock(), 5000)
    const result = await guard.check()
    expect(result.exceeded).toBe(false)
    expect(result.depth).toBe(100)
  })

  it('reports exceeded once depth reaches the ceiling (>=)', async () => {
    const source = new CountingDepthSource(5000)
    const guard = new GlobalQueueCeilingGuard(source, new FakeClock(), 5000)
    const result = await guard.check()
    expect(result.exceeded).toBe(true)
  })

  it('caches the depth for 1s in-process before re-querying the source', async () => {
    const clock = new FakeClock()
    const source = new CountingDepthSource(10)
    const guard = new GlobalQueueCeilingGuard(source, clock, 5000)

    await guard.check()
    await guard.check()
    expect(source.calls).toBe(1)

    clock.advanceMs(1000)
    await guard.check()
    expect(source.calls).toBe(2)
  })

  it('re-queries after the cache expires and reflects a new depth crossing the ceiling', async () => {
    const clock = new FakeClock()
    const source = new CountingDepthSource(10)
    const guard = new GlobalQueueCeilingGuard(source, clock, 5000)

    expect((await guard.check()).exceeded).toBe(false)

    source.setDepth(6000)
    clock.advanceMs(1000)
    expect((await guard.check()).exceeded).toBe(true)
  })
})

describe('globalQueueCeilingFromEnv', () => {
  const ORIGINAL = process.env.INT001_GLOBAL_QUEUE_CEILING

  it('defaults to 5000 when unset', () => {
    delete process.env.INT001_GLOBAL_QUEUE_CEILING
    expect(globalQueueCeilingFromEnv()).toBe(DEFAULT_GLOBAL_QUEUE_CEILING)
    if (ORIGINAL === undefined) delete process.env.INT001_GLOBAL_QUEUE_CEILING
    else process.env.INT001_GLOBAL_QUEUE_CEILING = ORIGINAL
  })

  it('reads a valid positive integer from env', () => {
    process.env.INT001_GLOBAL_QUEUE_CEILING = '1234'
    expect(globalQueueCeilingFromEnv()).toBe(1234)
    if (ORIGINAL === undefined) delete process.env.INT001_GLOBAL_QUEUE_CEILING
    else process.env.INT001_GLOBAL_QUEUE_CEILING = ORIGINAL
  })

  it('falls back to the default on a garbage value', () => {
    process.env.INT001_GLOBAL_QUEUE_CEILING = 'not-a-number'
    expect(globalQueueCeilingFromEnv()).toBe(DEFAULT_GLOBAL_QUEUE_CEILING)
    if (ORIGINAL === undefined) delete process.env.INT001_GLOBAL_QUEUE_CEILING
    else process.env.INT001_GLOBAL_QUEUE_CEILING = ORIGINAL
  })
})
