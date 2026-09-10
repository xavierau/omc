// WONB-001 KPI gate thresholds. Block-rate gate is intentionally dropped;
// real block ingestion lands in WONB-010. The 7d window is hard-coded.

export interface KpiThresholds {
  readonly minDeliveryRate: number
  readonly maxOptOutRate: number
  readonly minSampleSize: number
  readonly windowDays: number
}

export const DEFAULT_KPI_THRESHOLDS: KpiThresholds = Object.freeze({
  minDeliveryRate: 0.95,
  maxOptOutRate: 0.02,
  minSampleSize: 100,
  windowDays: 7,
})

export type KpiFailingMetric = 'delivery' | 'opt_out'
