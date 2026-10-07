// WONB-001: KPI gate adapter. Wraps `getQualityKpisForTenant` (the
// migration-045 RPC client) and applies the locked WONB thresholds:
// delivery >= 0.95 AND opt_out < 0.02 AND samples >= 100. Block-rate is
// intentionally omitted (lands in WONB-010).

import type {
  KpiGateEvaluator,
  KpiGateMetrics,
  KpiGateResult,
} from '@/domain/ports/kpi-gate-evaluator'
import {
  DEFAULT_KPI_THRESHOLDS,
  type KpiFailingMetric,
  type KpiThresholds,
} from '@/domain/value-objects/kpi-thresholds'
import { getQualityKpisForTenant } from '../repositories/quality-kpi-queries'

interface EvaluateArgs {
  restaurantId: string
  now?: Date
}

async function evaluate(args: EvaluateArgs): Promise<KpiGateResult> {
  const thresholds = DEFAULT_KPI_THRESHOLDS
  const kpis = await getQualityKpisForTenant({
    restaurantId: args.restaurantId,
    windowDays: thresholds.windowDays,
    now: args.now,
  })
  return decide(kpis, thresholds)
}

function decide(kpis: KpiGateMetrics, t: KpiThresholds): KpiGateResult {
  if (kpis.totalSends < t.minSampleSize) {
    return { status: 'insufficient', kpis, thresholds: t, failingMetrics: [] }
  }
  const failing = collectFailing(kpis, t)
  return failing.length === 0
    ? { status: 'pass', kpis, thresholds: t, failingMetrics: [] }
    : { status: 'fail', kpis, thresholds: t, failingMetrics: failing }
}

function collectFailing(
  kpis: KpiGateMetrics,
  t: KpiThresholds
): KpiFailingMetric[] {
  const out: KpiFailingMetric[] = []
  if (!(kpis.deliveryRate >= t.minDeliveryRate)) out.push('delivery')
  if (!(kpis.optOutRate < t.maxOptOutRate)) out.push('opt_out')
  return out
}

// Compile-time contract lock: if a future edit drifts the function shape,
// TS surfaces it here rather than at the call site.
export const kpiGateEvaluator: KpiGateEvaluator = { evaluate }
