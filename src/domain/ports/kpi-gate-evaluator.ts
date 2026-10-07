import type {
  KpiFailingMetric,
  KpiThresholds,
} from '@/domain/value-objects/kpi-thresholds'

/**
 * Quality KPI counters + derived rates over the gate window. Mirrors the
 * shape returned by the infra `quality-kpi-queries` module so the gate
 * adapter does not need to remap. Rates may be NaN when totalSends=0.
 */
export interface KpiGateMetrics {
  readonly totalSends: number
  readonly delivered: number
  readonly read: number
  readonly failed: number
  readonly optedOut: number
  readonly deliveryRate: number
  readonly readRate: number
  readonly errorRate: number
  readonly optOutRate: number
}

export type KpiGateStatus = 'pass' | 'fail' | 'insufficient'

export interface KpiGateResult {
  readonly status: KpiGateStatus
  readonly kpis: KpiGateMetrics
  readonly thresholds: KpiThresholds
  readonly failingMetrics: readonly KpiFailingMetric[]
}

/**
 * Domain port: evaluate the WONB-001 KPI gate for a tenant. The Supabase
 * adapter wraps `get_quality_kpis_for_tenant` (migration 045) and applies
 * thresholds locked in `DEFAULT_KPI_THRESHOLDS`.
 */
export interface KpiGateEvaluator {
  evaluate(args: { restaurantId: string; now?: Date }): Promise<KpiGateResult>
}
