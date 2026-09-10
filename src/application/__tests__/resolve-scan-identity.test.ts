import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  findCouponByCode: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/member-loyalty-repository', () => ({
  findMemberByLoyaltyToken: vi.fn(),
}))

import { resolveScanIdentity } from '@/application/resolve-scan-identity'
import { findCouponByCode } from '@/infrastructure/supabase/repositories/coupon-repository'
import { findMemberByLoyaltyToken } from '@/infrastructure/supabase/repositories/member-loyalty-repository'

const RESTAURANT_ID = 'rest-1'

function buildCoupon(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cp-1',
    restaurantId: RESTAURANT_ID,
    type: 'reward' as const,
    code: 'RWD-CODE01',
    status: 'active' as const,
    memberId: 'm-1',
    expiresAt: null,
    redeemedAt: null,
    discountType: null,
    discountValue: null,
    maxUses: 1,
    currentUses: 0,
    isActive: true,
    isChargeable: true,
    title: null,
    description: null,
    campaignId: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('resolveScanIdentity', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('loyalty QR strategy', () => {
    it('resolves a LOYALTY:<token> payload via tenant-scoped loyalty lookup', async () => {
      vi.mocked(findMemberByLoyaltyToken).mockResolvedValue('m-loyal')

      const result = await resolveScanIdentity('LOYALTY:abc123deadbeef', RESTAURANT_ID)

      expect(result).toEqual({ memberId: 'm-loyal' })
      expect(findMemberByLoyaltyToken).toHaveBeenCalledWith('abc123deadbeef', RESTAURANT_ID)
      expect(findCouponByCode).not.toHaveBeenCalled()
    })

    it('returns not_resolved when the loyalty token has no member', async () => {
      vi.mocked(findMemberByLoyaltyToken).mockResolvedValue(null)

      const result = await resolveScanIdentity('LOYALTY:missingtoken', RESTAURANT_ID)

      expect(result).toEqual({ error: 'not_resolved' })
    })
  })

  describe('coupon QR strategy', () => {
    it('resolves a bare coupon code to coupon.member_id', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(buildCoupon())

      const result = await resolveScanIdentity('RWD-CODE01', RESTAURANT_ID)

      expect(result).toEqual({ memberId: 'm-1' })
    })

    it('strips an optional REDEEM prefix and uppercases the code before lookup', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(buildCoupon())

      await resolveScanIdentity('REDEEM rwd-code01', RESTAURANT_ID)

      expect(findCouponByCode).toHaveBeenCalledWith('RWD-CODE01')
    })

    it('resolves even when the coupon is expired (reads only the persistent member link)', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(
        buildCoupon({ status: 'expired', memberId: 'm-exp' })
      )

      const result = await resolveScanIdentity('RWD-CODE01', RESTAURANT_ID)

      expect(result).toEqual({ memberId: 'm-exp' })
    })

    it('resolves even when the coupon is redeemed', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(
        buildCoupon({ status: 'redeemed', memberId: 'm-red' })
      )

      const result = await resolveScanIdentity('RWD-CODE01', RESTAURANT_ID)

      expect(result).toEqual({ memberId: 'm-red' })
    })

    it('HARD-GATES cross-tenant coupons → not_resolved immediately (no fall-through)', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(
        buildCoupon({ restaurantId: 'OTHER-TENANT', memberId: 'm-other' })
      )

      const result = await resolveScanIdentity('RWD-CODE01', RESTAURANT_ID)

      expect(result).toEqual({ error: 'not_resolved' })
    })

    it('returns not_resolved when a same-tenant coupon has no member link', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(buildCoupon({ memberId: null }))

      const result = await resolveScanIdentity('RWD-CODE01', RESTAURANT_ID)

      expect(result).toEqual({ error: 'not_resolved' })
    })
  })

  describe('no match', () => {
    it('returns not_resolved for an empty scan', async () => {
      const result = await resolveScanIdentity('   ', RESTAURANT_ID)
      expect(result).toEqual({ error: 'not_resolved' })
      expect(findCouponByCode).not.toHaveBeenCalled()
    })

    it('returns not_resolved when no coupon matches the code', async () => {
      vi.mocked(findCouponByCode).mockResolvedValue(null)

      const result = await resolveScanIdentity('UNKNOWN-CODE', RESTAURANT_ID)

      expect(result).toEqual({ error: 'not_resolved' })
    })
  })
})
