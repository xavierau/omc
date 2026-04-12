import { describe, it, expect } from 'vitest'
import { generateBillingCsv } from '../csv-export'
import type { TenantBillingRow } from '@/hooks/use-billing-report'

describe('generateBillingCsv', () => {
  it('generates correct headers and rows', () => {
    const rows: TenantBillingRow[] = [
      {
        tenantId: 'uuid-1',
        tenantName: 'Restaurant A',
        plan: 'starter',
        campaignsRun: 5,
        messagesSent: 450,
        estimatedCostUsd: 32.94,
        estimatedCostHkd: 256.93,
      },
      {
        tenantId: 'uuid-2',
        tenantName: 'Restaurant B',
        plan: 'growth',
        campaignsRun: 12,
        messagesSent: 1200,
        estimatedCostUsd: 87.6,
        estimatedCostHkd: 683.28,
      },
    ]

    const csv = generateBillingCsv(rows)
    const lines = csv.split('\n')

    expect(lines[0]).toBe('Tenant,Plan,Campaigns,Messages Sent,Cost (USD),Cost (HKD)')
    expect(lines[1]).toBe('Restaurant A,starter,5,450,32.94,256.93')
    expect(lines[2]).toBe('Restaurant B,growth,12,1200,87.60,683.28')
    expect(lines).toHaveLength(3)
  })

  it('returns only header for empty data', () => {
    const csv = generateBillingCsv([])
    const lines = csv.split('\n')

    expect(lines[0]).toBe('Tenant,Plan,Campaigns,Messages Sent,Cost (USD),Cost (HKD)')
    expect(lines).toHaveLength(1)
  })

  it('escapes commas in tenant names', () => {
    const rows: TenantBillingRow[] = [
      {
        tenantId: 'uuid-3',
        tenantName: 'Burgers, Fries & Co',
        plan: 'starter',
        campaignsRun: 1,
        messagesSent: 50,
        estimatedCostUsd: 3.65,
        estimatedCostHkd: 28.47,
      },
    ]

    const csv = generateBillingCsv(rows)
    const lines = csv.split('\n')

    expect(lines[1]).toBe('"Burgers, Fries & Co",starter,1,50,3.65,28.47')
  })
})
