// WAQ-010 Phase 1 — probe-boundary KPI snapshot logger.
//
// Emits exactly one structured log line at the moment the probe chunk
// finishes and BEFORE the first scale chunk runs. Phase 1 only records the
// snapshot for ops observability; Phase 2 will read these metrics async and
// auto-abort the run if delivery / read / error / opt-out KPIs miss
// thresholds (delivery >=95%, error <0.5%, etc.).
//
// Suppressed when there is no scale phase (single chunk run) — keeps the
// log line focused on actual probe→scale transitions.

import type { ChunkPlan } from './execute-campaign-batch-chunker'
import type { SkipCounters } from './execute-campaign-batch-counters'
import type { PacingConfig } from '@/domain/value-objects/pacing-strategy'

export interface ProbeLogContext {
  campaignId: string
  pacingConfig: PacingConfig
}

export function maybeLogProbeBoundary(
  plan: ChunkPlan[],
  index: number,
  ctx: ProbeLogContext,
  counters: SkipCounters
): void {
  if (index !== 0) return
  if (!plan[0]?.isProbe) return
  if (plan.length < 2) return

  const skipped = sumSkipped(counters)
  const failed = counters.failed
  const probeSize = plan[0].members.length
  // Invariant for downstream KPI consumers: sent + skipped + failed ===
  // probeSize. `failed` is its own bucket (rejected promises from the BSP
  // path), distinct from the "skipped" gate decisions, so it must NOT be
  // double-counted inside skipped. Phase 2 KPI thresholds (delivery >=95%,
  // error <0.5%) read these fields directly.
  console.info('campaign.probe_chunk_complete', {
    campaignId: ctx.campaignId,
    probeSize,
    sent: probeSize - skipped - failed,
    skipped,
    failed,
    pacingStrategy: ctx.pacingConfig.strategy,
    activeHoursStartLocal: ctx.pacingConfig.activeHoursStartLocal,
    activeHoursEndLocal: ctx.pacingConfig.activeHoursEndLocal,
  })
}

function sumSkipped(c: SkipCounters): number {
  return c.noConsent + c.capExceeded + c.throttled + c.unreachable
}
