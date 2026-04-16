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
    redemptions_count: 0,
    commission_per_redemption: 0,
    broadcast_commission: 7.5,
    redemption_commission: 0,
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
      redemptionsCount: 0,
      commissionPerRedemption: 0,
      broadcastCommission: 7.5,
      redemptionCommission: 0,
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

  it('maps dual-stream columns from DB row without fallbacks', () => {
    const row = buildRow({
      messages_sent: 200,
      redemptions_count: 40,
      commission_per_message: 0.06,
      commission_per_redemption: 0.2,
      broadcast_commission: 12,
      redemption_commission: 8,
      total_commission: 20,
    })
    const result = mapRowToCommission(row)

    expect(result.redemptionsCount).toBe(40)
    expect(result.commissionPerRedemption).toBe(0.2)
    expect(result.broadcastCommission).toBe(12)
    expect(result.redemptionCommission).toBe(8)
    expect(result.totalCommission).toBe(20)
  })
})

describe('mapCommissionToUpsert', () => {
  it('maps all fields from camelCase to snake_case including dual streams', () => {
    const result = mapCommissionToUpsert({
      referrerId: 'ref-2',
      month: '2026-04',
      tenantId: 'tenant-2',
      tenantName: 'Sushi Bar',
      messagesSent: 200,
      redemptionsCount: 50,
      commissionPerMessage: 0.06,
      commissionPerRedemption: 0.2,
      broadcastCommission: 12.0,
      redemptionCommission: 10.0,
      totalCommission: 22.0,
    })

    expect(result).toEqual({
      referrer_id: 'ref-2',
      month: '2026-04',
      tenant_id: 'tenant-2',
      tenant_name: 'Sushi Bar',
      messages_sent: 200,
      redemptions_count: 50,
      commission_per_message: 0.06,
      commission_per_redemption: 0.2,
      broadcast_commission: 12.0,
      redemption_commission: 10.0,
      total_commission: 22.0,
    })
  })

  it('handles zero counts and commissions', () => {
    const result = mapCommissionToUpsert({
      referrerId: 'ref-1',
      month: '2026-01',
      tenantId: 'tenant-1',
      tenantName: 'Test',
      messagesSent: 0,
      redemptionsCount: 0,
      commissionPerMessage: 0.05,
      commissionPerRedemption: 0.1,
      broadcastCommission: 0,
      redemptionCommission: 0,
      totalCommission: 0,
    })

    expect(result.messages_sent).toBe(0)
    expect(result.redemptions_count).toBe(0)
    expect(result.broadcast_commission).toBe(0)
    expect(result.redemption_commission).toBe(0)
    expect(result.total_commission).toBe(0)
  })
})
