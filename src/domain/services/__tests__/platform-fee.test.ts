import { describe, it, expect } from 'vitest'
import {
  BROADCAST_PLATFORM_FEE_HKD,
  REDEMPTION_PLATFORM_FEE_HKD,
  calculateBroadcastFee,
  calculateRedemptionFee,
  calculateTotalPlatformFee,
} from '../platform-fee'

describe('platform-fee', () => {
  describe('constants', () => {
    it('broadcast fee is HK$0.3 per message', () => {
      expect(BROADCAST_PLATFORM_FEE_HKD).toBe(0.3)
    })

    it('redemption fee is HK$0.3 per redemption', () => {
      expect(REDEMPTION_PLATFORM_FEE_HKD).toBe(0.3)
    })
  })

  describe('calculateBroadcastFee', () => {
    it('returns 0 for zero messages', () => {
      expect(calculateBroadcastFee(0)).toBe(0)
    })

    it('returns 0.3 for a single message', () => {
      expect(calculateBroadcastFee(1)).toBe(0.3)
    })

    it('returns 30 for 100 messages', () => {
      expect(calculateBroadcastFee(100)).toBe(30)
    })

    it('returns 300 for 1000 messages', () => {
      expect(calculateBroadcastFee(1000)).toBe(300)
    })

    it('rounds to 2 decimal places', () => {
      expect(calculateBroadcastFee(7)).toBe(2.1)
    })
  })

  describe('calculateRedemptionFee', () => {
    it('returns 0 for zero redemptions', () => {
      expect(calculateRedemptionFee(0)).toBe(0)
    })

    it('returns 0.3 for a single redemption', () => {
      expect(calculateRedemptionFee(1)).toBe(0.3)
    })

    it('returns 30 for 100 redemptions', () => {
      expect(calculateRedemptionFee(100)).toBe(30)
    })

    it('returns 300 for 1000 redemptions', () => {
      expect(calculateRedemptionFee(1000)).toBe(300)
    })

    it('rounds to 2 decimal places', () => {
      expect(calculateRedemptionFee(7)).toBe(2.1)
    })
  })

  describe('calculateTotalPlatformFee', () => {
    it('returns 0 when both counts are zero', () => {
      expect(calculateTotalPlatformFee(0, 0)).toBe(0)
    })

    it('sums broadcast and redemption fees', () => {
      expect(calculateTotalPlatformFee(100, 50)).toBe(45)
    })

    it('handles messages-only scenario', () => {
      expect(calculateTotalPlatformFee(10, 0)).toBe(3)
    })

    it('handles redemptions-only scenario', () => {
      expect(calculateTotalPlatformFee(0, 10)).toBe(3)
    })

    it('rounds the total to 2 decimal places', () => {
      expect(calculateTotalPlatformFee(1, 1)).toBe(0.6)
    })
  })
})
