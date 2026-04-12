import { describe, it, expect } from 'vitest'
import {
  mapRowToCommission,
  mapCommissionToUpsert,
  type ReferrerCommissionRow,
} from '../referrer-commission-mapper'

function buildRow(
  overrides: Partial<ReferrerCommissionRow> = {}
): ReferrerCommissionRow {
  return {
    id: 'rc-1',
    referrer_id: 'ref-1',
    month: '2026-03',
    tenant_id: 'tenant-1',
    tenant_name: 'Happy Cafe',
    messages_sent: 150,
    commission_per_message: 0.05,
    total_commission: 7.5,
    status: 'pending',
    paid_at: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  }
}

describe('mapRowToCommission', () => {
  it('maps all fields from DB row to domain type', () => {
    const row = buildRow()
    const result = mapRowToCommission(row)

    expect(result).toEqual({
      id: 'rc-1',
      referrerId: 'ref-1',
      month: '2026-03',
      tenantId: 'tenant-1',
      tenantName: 'Happy Cafe',
      messagesSent: 150,
      commissionPerMessage: 0.05,
      totalCommission: 7.5,
      status: 'pending',
      paidAt: null,
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    })
  })

  it('maps paid_at when present', () => {
    const row = buildRow({
      status: 'paid',
      paid_at: '2026-04-10T12:00:00Z',
    })
    const result = mapRowToCommission(row)

    expect(result.status).toBe('paid')
    expect(result.paidAt).toBe('2026-04-10T12:00:00Z')
  })

  it('maps null paid_at to null', () => {
    const row = buildRow({ paid_at: null })
    const result = mapRowToCommission(row)

    expect(result.paidAt).toBeNull()
  })
})

describe('mapCommissionToUpsert', () => {
  it('maps all fields from camelCase to snake_case', () => {
    const result = mapCommissionToUpsert({
      referrerId: 'ref-2',
      month: '2026-04',
      tenantId: 'tenant-2',
      tenantName: 'Sushi Bar',
      messagesSent: 200,
      commissionPerMessage: 0.06,
      totalCommission: 12.0,
    })

    expect(result).toEqual({
      referrer_id: 'ref-2',
      month: '2026-04',
      tenant_id: 'tenant-2',
      tenant_name: 'Sushi Bar',
      messages_sent: 200,
      commission_per_message: 0.06,
      total_commission: 12.0,
    })
  })
})
