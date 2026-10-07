import { describe, it, expect } from 'vitest'
import { generateCommissionCsv } from '../csv-export'
import type { CommissionRow } from '@/application/generate-referrer-report'

const BOM = '\ufeff'
const HEADER =
  'Referrer,Tenant,Messages Sent,Rate (HK$/msg),Broadcast Commission (HK$),Redemptions,Rate (HK$/redemption),Redemption Commission (HK$),Total Commission (HK$)'

function buildRow(overrides: Partial<CommissionRow> = {}): CommissionRow {
  return {
    referrerId: 'ref-1',
    referrerName: 'Acme',
    tenantId: 'tenant-1',
    tenantName: 'Happy Cafe',
    messagesSent: 150,
    redemptionsCount: 40,
    commissionPerMessage: 0.05,
    commissionPerRedemption: 0.1,
    broadcastCommission: 7.5,
    redemptionCommission: 4,
    totalCommission: 11.5,
    ...overrides,
  }
}

describe('generateCommissionCsv', () => {
  it('returns BOM + header only for empty input', () => {
    expect(generateCommissionCsv([])).toBe(BOM + HEADER)
  })

  it('prepends UTF-8 BOM so Excel renders HK$ and Chinese correctly', () => {
    const csv = generateCommissionCsv([buildRow()])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.startsWith(BOM)).toBe(true)
  })

  it('emits dual-stream columns in broadcast-then-redemption order', () => {
    const csv = generateCommissionCsv([buildRow()])
    const lines = csv.split('\n')

    expect(lines[0]).toBe(BOM + HEADER)
    expect(lines[1]).toBe('Acme,Happy Cafe,150,0.05,7.50,40,0.10,4.00,11.50')
  })

  it('escapes commas in referrer and tenant names', () => {
    const csv = generateCommissionCsv([
      buildRow({
        referrerName: 'Partner, Inc',
        tenantName: 'Burgers, Fries & Co',
      }),
    ])
    const lines = csv.split('\n')

    expect(lines[1]).toBe(
      '"Partner, Inc","Burgers, Fries & Co",150,0.05,7.50,40,0.10,4.00,11.50'
    )
  })

  it('handles zero-redemption rows cleanly', () => {
    const csv = generateCommissionCsv([
      buildRow({
        redemptionsCount: 0,
        commissionPerRedemption: 0.1,
        redemptionCommission: 0,
        totalCommission: 7.5,
      }),
    ])
    const lines = csv.split('\n')

    expect(lines[1]).toBe('Acme,Happy Cafe,150,0.05,7.50,0,0.10,0.00,7.50')
  })
})
