import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import { getSystemReply } from '../system-replies'

describe('getSystemReply', () => {
  describe('nonMember', () => {
    it('EN tells the user to reply JOIN', () => {
      const text = getSystemReply('nonMember', Language.EN)
      expect(text).toContain('not a member')
      expect(text).toContain('JOIN')
    })

    it('ZH mentions 會員 and JOIN', () => {
      const text = getSystemReply('nonMember', Language.ZH_HK)
      expect(text).toContain('會員')
      expect(text).toContain('JOIN')
    })
  })

  describe('balance', () => {
    it('EN interpolates points and mentions receipt', () => {
      const text = getSystemReply('balance', Language.EN, { points: 42 })
      expect(text).toContain('42')
      expect(text).toContain('points')
      expect(text.toLowerCase()).toContain('receipt')
    })

    it('ZH interpolates points with 積分', () => {
      const text = getSystemReply('balance', Language.ZH_HK, { points: 42 })
      expect(text).toContain('42')
      expect(text).toContain('積分')
    })
  })

  describe('unsubscribed', () => {
    it('EN confirms unsubscribe and mentions JOIN', () => {
      const text = getSystemReply('unsubscribed', Language.EN)
      expect(text).toContain('unsubscribed')
      expect(text).toContain('JOIN')
    })

    it('ZH confirms unsubscribe and mentions JOIN', () => {
      const text = getSystemReply('unsubscribed', Language.ZH_HK)
      expect(text).toContain('取消訂閱')
      expect(text).toContain('JOIN')
    })
  })

  describe('rewardsEmpty', () => {
    it('EN mentions no rewards available', () => {
      const text = getSystemReply('rewardsEmpty', Language.EN)
      expect(text.toLowerCase()).toContain('no rewards')
    })

    it('ZH mentions 暫無 or 暫未有 rewards', () => {
      const text = getSystemReply('rewardsEmpty', Language.ZH_HK)
      expect(text).toMatch(/暫/)
      expect(text).toContain('獎賞')
    })
  })

  describe('rewardsHeader', () => {
    it('EN interpolates points', () => {
      const text = getSystemReply('rewardsHeader', Language.EN, { points: 500 })
      expect(text).toContain('500')
      expect(text.toLowerCase()).toContain('reward')
    })

    it('ZH interpolates points with 積分', () => {
      const text = getSystemReply('rewardsHeader', Language.ZH_HK, { points: 500 })
      expect(text).toContain('500')
      expect(text).toContain('積分')
      expect(text).toContain('獎賞')
    })
  })

  describe('cantAfford', () => {
    it('EN includes balance, next reward name and cost', () => {
      const text = getSystemReply('cantAfford', Language.EN, {
        points: 10,
        name: 'Free Coffee',
        cost: 50,
      })
      expect(text).toContain('10')
      expect(text).toContain('Free Coffee')
      expect(text).toContain('50')
    })

    it('ZH includes balance, next reward name and 積分', () => {
      const text = getSystemReply('cantAfford', Language.ZH_HK, {
        points: 10,
        name: 'Free Coffee',
        cost: 50,
      })
      expect(text).toContain('10')
      expect(text).toContain('Free Coffee')
      expect(text).toContain('50')
      expect(text).toContain('積分')
    })
  })

  describe('receiptAck', () => {
    it('EN acknowledges and mentions scanning', () => {
      const text = getSystemReply('receiptAck', Language.EN)
      expect(text.toLowerCase()).toContain('receipt')
      expect(text.toLowerCase()).toContain('scan')
    })

    it('ZH acknowledges and mentions 掃描', () => {
      const text = getSystemReply('receiptAck', Language.ZH_HK)
      expect(text).toContain('收據')
      expect(text).toContain('掃描')
    })
  })

  describe('receiptImageMissing', () => {
    it('EN apologises and asks to retry', () => {
      const text = getSystemReply('receiptImageMissing', Language.EN)
      expect(text.toLowerCase()).toContain('could not')
      expect(text.toLowerCase()).toMatch(/try again|retry/)
    })

    it('ZH apologises and asks to retry', () => {
      const text = getSystemReply('receiptImageMissing', Language.ZH_HK)
      expect(text).toContain('抱歉')
      expect(text).toMatch(/再試|重試/)
    })
  })

  describe('button labels', () => {
    it('EN points button is "Check Points"', () => {
      expect(getSystemReply('buttonPoints', Language.EN)).toBe('Check Points')
    })

    it('ZH points button is 查詢積分', () => {
      expect(getSystemReply('buttonPoints', Language.ZH_HK)).toBe('查詢積分')
    })

    it('EN rewards button is "View Rewards"', () => {
      expect(getSystemReply('buttonRewards', Language.EN)).toBe('View Rewards')
    })

    it('ZH rewards button is 查看獎賞', () => {
      expect(getSystemReply('buttonRewards', Language.ZH_HK)).toBe('查看獎賞')
    })

    it('EN help button is "Help"', () => {
      expect(getSystemReply('buttonHelp', Language.EN)).toBe('Help')
    })

    it('ZH help button is 幫助', () => {
      expect(getSystemReply('buttonHelp', Language.ZH_HK)).toBe('幫助')
    })
  })

  describe('campaignUnavailable (CAMP-001)', () => {
    it('EN says the promotion is not available', () => {
      const text = getSystemReply('campaignUnavailable', Language.EN)
      expect(text.toLowerCase()).toContain("isn't available")
    })

    it('ZH apologises and mentions 優惠', () => {
      const text = getSystemReply('campaignUnavailable', Language.ZH_HK)
      expect(text).toContain('抱歉')
      expect(text).toContain('優惠')
    })
  })

  describe('claimReady (CAMP-001)', () => {
    it('EN interpolates the coupon code and mentions coupon', () => {
      const text = getSystemReply('claimReady', Language.EN, { code: 'ABC123' })
      expect(text).toContain('ABC123')
      expect(text.toLowerCase()).toContain('coupon')
    })

    it('ZH interpolates the coupon code and mentions 優惠券', () => {
      const text = getSystemReply('claimReady', Language.ZH_HK, { code: 'ABC123' })
      expect(text).toContain('ABC123')
      expect(text).toContain('優惠券')
    })
  })

  describe('reward button label', () => {
    it('EN renders "{name} ({cost}pts)"', () => {
      const text = getSystemReply('rewardButton', Language.EN, {
        name: 'Coffee',
        cost: 50,
      })
      expect(text).toBe('Coffee (50pts)')
    })

    it('ZH renders "{name} ({cost} 積分)"', () => {
      const text = getSystemReply('rewardButton', Language.ZH_HK, {
        name: 'Coffee',
        cost: 50,
      })
      expect(text).toBe('Coffee (50 積分)')
    })
  })
})
