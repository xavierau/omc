// WONB-001: KPI gate evaluator wraps `getQualityKpisForTenant` (migration
// 045 RPC) and decides pass / fail / insufficient against the locked
// thresholds (delivery >= 0.95, opt_out < 0.02, sample >= 100).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../repositories/quality-kpi-queries', () => ({
  getQualityKpisForTenant: vi.fn(),
}))

import { getQualityKpisForTenant } from '../../repositories/quality-kpi-queries'
import { kpiGateEvaluator } from '../kpi-gate-evaluator-supabase'

beforeEach(() => vi.clearAllMocks())

const baseKpis = {
  totalSends: 200,
  delivered: 200,
  read: 100,
  failed: 0,
  optedOut: 0,
  deliveryRate: 1,
  readRate: 0.5,
  errorRate: 0,
  optOutRate: 0,
}

describe('kpiGateEvaluator.evaluate', () => {
  it('passes when delivery >= 0.95 AND opt_out < 0.02 AND samples >= 100', async () => {
    vi.mocked(getQualityKpisForTenant).mockResolvedValue(baseKpis)
    const r = await kpiGateEvaluator.evaluate({ restaurantId: 'rest-1' })
    expect(r.status).toBe('pass')
    expect(r.failingMetrics).toEqual([])
  })

  it('returns insufficient when totalSends < 100', async () => {
    vi.mocked(getQualityKpisForTenant).mockResolvedValue({
      ...baseKpis,
      totalSends: 50,
      delivered: 50,
    })
    const r = await kpiGateEvaluator.evaluate({ restaurantId: 'rest-1' })
    expect(r.status).toBe('insufficient')
    expect(r.failingMetrics).toEqual([])
    expect(r.kpis.totalSends).toBe(50)
  })

  it('fails with failingMetrics=["delivery"] when deliveryRate < 0.95', async () => {
    vi.mocked(getQualityKpisForTenant).mockResolvedValue({
      ...baseKpis,
      delivered: 180,
      deliveryRate: 0.9,
    })
    const r = await kpiGateEvaluator.evaluate({ restaurantId: 'rest-1' })
    expect(r.status).toBe('fail')
    expect(r.failingMetrics).toEqual(['delivery'])
  })

  it('fails with failingMetrics=["opt_out"] when optOutRate >= 0.02', async () => {
    vi.mocked(getQualityKpisForTenant).mockResolvedValue({
      ...baseKpis,
      optedOut: 6,
      optOutRate: 0.03,
    })
    const r = await kpiGateEvaluator.evaluate({ restaurantId: 'rest-1' })
    expect(r.status).toBe('fail')
    expect(r.failingMetrics).toEqual(['opt_out'])
  })

  it('fails with both metrics when both thresholds are breached', async () => {
    vi.mocked(getQualityKpisForTenant).mockResolvedValue({
      ...baseKpis,
      delivered: 150,
      deliveryRate: 0.75,
      optedOut: 10,
      optOutRate: 0.05,
    })
    const r = await kpiGateEvaluator.evaluate({ restaurantId: 'rest-1' })
    expect(r.status).toBe('fail')
    expect(r.failingMetrics).toEqual(['delivery', 'opt_out'])
  })

  it('insufficient takes precedence over fail when sample is too small', async () => {
    vi.mocked(getQualityKpisForTenant).mockResolvedValue({
      ...baseKpis,
      totalSends: 10,
      delivered: 1,
      deliveryRate: 0.1,
      optedOut: 5,
      optOutRate: 0.5,
    })
    const r = await kpiGateEvaluator.evaluate({ restaurantId: 'rest-1' })
    expect(r.status).toBe('insufficient')
    expect(r.failingMetrics).toEqual([])
  })

  it('passes the configured 7d window down to the RPC call', async () => {
    const now = new Date('2026-05-04T00:00:00.000Z')
    vi.mocked(getQualityKpisForTenant).mockResolvedValue(baseKpis)
    await kpiGateEvaluator.evaluate({ restaurantId: 'rest-1', now })
    expect(getQualityKpisForTenant).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      windowDays: 7,
      now,
    })
  })

  it('returns thresholds in the result so the UI can render the gate panel', async () => {
    vi.mocked(getQualityKpisForTenant).mockResolvedValue(baseKpis)
    const r = await kpiGateEvaluator.evaluate({ restaurantId: 'rest-1' })
    expect(r.thresholds).toEqual({
      minDeliveryRate: 0.95,
      maxOptOutRate: 0.02,
      minSampleSize: 100,
      windowDays: 7,
    })
  })
})
