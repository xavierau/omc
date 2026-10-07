import { describe, it, expect } from 'vitest'
import { generateBillingCsv } from '../csv-export'
import type { TenantBillingRow } from '@/hooks/use-billing-report'

const BOM = '\ufeff'
const HEADER =
  'Tenant,Plan,Campaigns,Messages Sent,Cost (USD),Cost (HKD),Meta Cost (HKD),Broadcast Fee (HKD),Redemptions,Redemption Fee (HKD),Total Charge (HKD)'

function buildRow(overrides: Partial<TenantBillingRow> = {}): TenantBillingRow {
  return {
    tenantId: 'uuid-1',
    tenantName: 'Restaurant A',
    plan: 'starter',
    campaignsRun: 5,
    messagesSent: 450,
    estimatedCostUsd: 32.94,
    estimatedCostHkd: 256.93,
    metaCostHkd: 256.93,
    broadcastFeeHkd: 135,
    redemptionsCount: 0,
    redemptionFeeHkd: 0,
    totalChargeHkd: 391.93,
    ...overrides,
  }
}

describe('generateBillingCsv', () => {
  it('generates correct headers including dual-stream columns', () => {
    const rows: TenantBillingRow[] = [
      buildRow(),
      buildRow({
        tenantId: 'uuid-2',
        tenantName: 'Restaurant B',
        plan: 'growth',
        campaignsRun: 12,
        messagesSent: 1200,
        estimatedCostUsd: 87.6,
        estimatedCostHkd: 683.28,
        metaCostHkd: 683.28,
        broadcastFeeHkd: 360,
        redemptionsCount: 10,
        redemptionFeeHkd: 3,
        totalChargeHkd: 1046.28,
      }),
    ]

    const csv = generateBillingCsv(rows)
    const lines = csv.split('\n')

    expect(lines[0]).toBe(BOM + HEADER)
    expect(lines[1]).toBe(
      'Restaurant A,starter,5,450,32.94,256.93,256.93,135.00,0,0.00,391.93'
    )
    expect(lines[2]).toBe(
      'Restaurant B,growth,12,1200,87.60,683.28,683.28,360.00,10,3.00,1046.28'
    )
    expect(lines).toHaveLength(3)
  })

  it('prepends UTF-8 BOM so Excel renders HK$ and Chinese correctly', () => {
    const csv = generateBillingCsv([buildRow()])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.startsWith(BOM)).toBe(true)
  })

  it('returns BOM + header only for empty data', () => {
    const csv = generateBillingCsv([])
    expect(csv).toBe(BOM + HEADER)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('escapes commas in tenant names', () => {
    const rows: TenantBillingRow[] = [
      buildRow({
        tenantId: 'uuid-3',
        tenantName: 'Burgers, Fries & Co',
        campaignsRun: 1,
        messagesSent: 50,
        estimatedCostUsd: 3.65,
        estimatedCostHkd: 28.47,
        metaCostHkd: 28.47,
        broadcastFeeHkd: 15,
        redemptionsCount: 0,
        redemptionFeeHkd: 0,
        totalChargeHkd: 43.47,
      }),
    ]

    const csv = generateBillingCsv(rows)
    const lines = csv.split('\n')

    expect(lines[1]).toBe(
      '"Burgers, Fries & Co",starter,1,50,3.65,28.47,28.47,15.00,0,0.00,43.47'
    )
  })

  it('emits redemption columns when tenant has redemptions', () => {
    const rows: TenantBillingRow[] = [
      buildRow({
        redemptionsCount: 25,
        redemptionFeeHkd: 7.5,
        totalChargeHkd: 399.43,
      }),
    ]

    const csv = generateBillingCsv(rows)
    const lines = csv.split('\n')

    expect(lines[1]).toBe(
      'Restaurant A,starter,5,450,32.94,256.93,256.93,135.00,25,7.50,399.43'
    )
  })
})
