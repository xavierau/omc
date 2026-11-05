import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import {
  rewardNotFoundMessage,
  rewardInsufficientPointsMessage,
  rewardRedeemedCelebration,
  rewardQrCaption,
} from '../redeem-reward-messages'

describe('redeem-reward-messages', () => {
  describe('rewardNotFoundMessage', () => {
    it('EN — "Reward not found."', () => {
      expect(rewardNotFoundMessage(Language.EN)).toContain('not found')
    })

    it('ZH — 找不到此獎賞', () => {
      expect(rewardNotFoundMessage(Language.ZH_HK)).toContain('找不到')
      expect(rewardNotFoundMessage(Language.ZH_HK)).toContain('獎賞')
    })
  })

  describe('rewardInsufficientPointsMessage', () => {
    it('EN — mentions "Not enough points", balance, and cost', () => {
      const text = rewardInsufficientPointsMessage(Language.EN, {
        balance: 30,
        cost: 100,
      })
      expect(text).toContain('Not enough points')
      expect(text).toContain('30')
      expect(text).toContain('100')
    })

    it('ZH — mentions 積分不足 and numbers', () => {
      const text = rewardInsufficientPointsMessage(Language.ZH_HK, {
        balance: 30,
        cost: 100,
      })
      expect(text).toContain('積分不足')
      expect(text).toContain('30')
      expect(text).toContain('100')
    })
  })

  describe('rewardRedeemedCelebration', () => {
    it('EN — percentage includes name, cost, code, new balance, and "% off"', () => {
      const text = rewardRedeemedCelebration(Language.EN, {
        name: 'Free Coffee',
        pointsCost: 50,
        discountType: 'percentage',
        discountValue: 100,
        code: 'RWD-CODE01',
        newBalance: 200,
      })
      expect(text).toContain('Free Coffee')
      expect(text).toContain('50')
      expect(text).toContain('RWD-CODE01')
      expect(text).toContain('200')
      expect(text).toContain('100%')
    })

    it('ZH — percentage includes 兌換 and 積分', () => {
      const text = rewardRedeemedCelebration(Language.ZH_HK, {
        name: 'Free Coffee',
        pointsCost: 50,
        discountType: 'percentage',
        discountValue: 100,
        code: 'RWD-CODE01',
        newBalance: 200,
      })
      expect(text).toContain('Free Coffee')
      expect(text).toContain('兌換')
      expect(text).toContain('積分')
      expect(text).toContain('RWD-CODE01')
      expect(text).toContain('200')
      expect(text).toContain('100%')
    })

    it('EN — fixed_amount includes HK$ amount', () => {
      const text = rewardRedeemedCelebration(Language.EN, {
        name: 'Dinner',
        pointsCost: 300,
        discountType: 'fixed_amount',
        discountValue: 50,
        code: 'XYZ',
        newBalance: 10,
      })
      expect(text).toContain('HK$50')
    })

    it('ZH — fixed_amount includes HK$ amount', () => {
      const text = rewardRedeemedCelebration(Language.ZH_HK, {
        name: 'Dinner',
        pointsCost: 300,
        discountType: 'fixed_amount',
        discountValue: 50,
        code: 'XYZ',
        newBalance: 10,
      })
      expect(text).toContain('HK$50')
      expect(text).toContain('兌換')
    })
  })

  describe('rewardQrCaption', () => {
    it('EN — "Your code: CODE"', () => {
      expect(rewardQrCaption(Language.EN, { code: 'ABC' })).toBe(
        'Your code: ABC'
      )
    })

    it('ZH — 您的代碼：CODE', () => {
      expect(rewardQrCaption(Language.ZH_HK, { code: 'ABC' })).toBe(
        '您的代碼：ABC'
      )
    })
  })
})
