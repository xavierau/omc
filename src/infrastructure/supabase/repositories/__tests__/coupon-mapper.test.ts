import { describe, it, expect } from 'vitest'
import { mapRowToCoupon } from '../coupon-mapper'

function buildRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'cpn-1',
    restaurant_id: 'rest-1',
    type: 'welcome',
    code: 'WELCOME10',
    status: 'active',
    member_id: 'mem-1',
    expires_at: '2026-12-31T23:59:59Z',
    redeemed_at: '2026-06-01T12:00:00Z',
    discount_type: 'percentage',
    discount_value: 10,
    max_uses: 5,
    current_uses: 2,
    is_active: true,
    title: 'Welcome Discount',
    description: '10% off your first order',
    campaign_id: 'camp-1',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('mapRowToCoupon', () => {
  it('maps snake_case DB row to camelCase Coupon with all fields', () => {
    const row = buildRow()
    const result = mapRowToCoupon(row)

    expect(result).toEqual({
      id: 'cpn-1',
      restaurantId: 'rest-1',
      type: 'welcome',
      code: 'WELCOME10',
      status: 'active',
      memberId: 'mem-1',
      expiresAt: '2026-12-31T23:59:59Z',
      redeemedAt: '2026-06-01T12:00:00Z',
      discountType: 'percentage',
      discountValue: 10,
      maxUses: 5,
      currentUses: 2,
      isActive: true,
      title: 'Welcome Discount',
      description: '10% off your first order',
      campaignId: 'camp-1',
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('handles null/undefined optional fields gracefully', () => {
    const row = buildRow({
      member_id: null,
      expires_at: undefined,
      redeemed_at: null,
      discount_type: null,
      discount_value: null,
      max_uses: undefined,
      current_uses: undefined,
      title: null,
      description: null,
      campaign_id: null,
    })
    const result = mapRowToCoupon(row)

    expect(result.memberId).toBeNull()
    expect(result.expiresAt).toBeNull()
    expect(result.redeemedAt).toBeNull()
    expect(result.discountType).toBeNull()
    expect(result.discountValue).toBeNull()
    expect(result.maxUses).toBeNull()
    expect(result.currentUses).toBe(0)
    expect(result.title).toBeNull()
    expect(result.description).toBeNull()
    expect(result.campaignId).toBeNull()
  })

  it('maps all discount types correctly', () => {
    const percentage = mapRowToCoupon(
      buildRow({ discount_type: 'percentage', discount_value: 15 })
    )
    expect(percentage.discountType).toBe('percentage')
    expect(percentage.discountValue).toBe(15)

    const fixed = mapRowToCoupon(
      buildRow({ discount_type: 'fixed_amount', discount_value: 50 })
    )
    expect(fixed.discountType).toBe('fixed_amount')
    expect(fixed.discountValue).toBe(50)

    const none = mapRowToCoupon(
      buildRow({ discount_type: null, discount_value: null })
    )
    expect(none.discountType).toBeNull()
    expect(none.discountValue).toBeNull()
  })
})
