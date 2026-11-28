// INT-001 WI-2 T-M7: global waiting-job ceiling on `integration-inbound`,
// on top of the per-integration cap (`int001:depth:{integrationId}`, WI-3).
// Twenty integrations x 500 (the per-integration default) is 10k waiting
// jobs on a 4GB VM shared by 17 sites -- this is the backstop.
//
// WI-2 builds the reusable, cached primitive; the real BullMQ queue for
// `integration-inbound` does not exist until WI-3, so WI-3 wires this to
// `getWaitingCount() + getDelayedCount()` and calls `.check()` before
// `q.add`. Kept generic (an injected `QueueDepthSource`) precisely so it is
// testable now without that queue.

import type { Clock } from '@/domain/ports/clock'

const CACHE_TTL_MS = 1000

export interface QueueDepthSource {
  getDepth(): Promise<number>
}

export interface GlobalQueueCeilingResult {
  exceeded: boolean
  depth: number
}

export class GlobalQueueCeilingGuard {
  private cachedDepth: number | null = null
  private cachedAtMs = -Infinity

  constructor(
    private readonly source: QueueDepthSource,
    private readonly clock: Clock,
    private readonly ceiling: number
  ) {}

  async check(): Promise<GlobalQueueCeilingResult> {
    const nowMs = this.clock.now().getTime()
    if (this.cachedDepth === null || nowMs - this.cachedAtMs >= CACHE_TTL_MS) {
      this.cachedDepth = await this.source.getDepth()
      this.cachedAtMs = nowMs
    }
    return { exceeded: this.cachedDepth >= this.ceiling, depth: this.cachedDepth }
  }
}

export const DEFAULT_GLOBAL_QUEUE_CEILING = 5000

export function globalQueueCeilingFromEnv(): number {
  const raw = process.env.INT001_GLOBAL_QUEUE_CEILING
  if (!raw) return DEFAULT_GLOBAL_QUEUE_CEILING
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_GLOBAL_QUEUE_CEILING
}
