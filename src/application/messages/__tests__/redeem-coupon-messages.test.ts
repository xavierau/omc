import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import {
  couponNotFoundMessage,
  couponInactiveMessage,
  couponExpiredMessage,
  couponMaxUsesMessage,
  couponAlreadyUsedMessage,
  couponSuccessMessage,
} from '../redeem-coupon-messages'

describe('redeem-coupon-messages', () => {
  describe('couponNotFoundMessage', () => {
    it('EN — "code doesn\'t look right" style', () => {
      const text = couponNotFoundMessage(Language.EN)
      expect(text).toContain("doesn't look right")
    })

    it('ZH — mentions 代碼 and try again', () => {
      const text = couponNotFoundMessage(Language.ZH_HK)
      expect(text).toContain('代碼')
      expect(text).toMatch(/再試|不正確/)
    })
  })

  describe('couponInactiveMessage', () => {
    it('EN — "no longer active"', () => {
      expect(couponInactiveMessage(Language.EN)).toContain('no longer active')
    })

    it('ZH — 已失效', () => {
      expect(couponInactiveMessage(Language.ZH_HK)).toContain('失效')
    })
  })

  describe('couponExpiredMessage', () => {
    it('EN — mentions expired', () => {
      expect(couponExpiredMessage(Language.EN)).toContain('expired')
    })

    it('ZH — 已過期', () => {
      expect(couponExpiredMessage(Language.ZH_HK)).toContain('過期')
    })
  })

  describe('couponMaxUsesMessage', () => {
    it('EN — mentions maximum uses or usage limit', () => {
      expect(couponMaxUsesMessage(Language.EN).toLowerCase()).toMatch(
        /maximum uses|usage limit/
      )
    })

    it('ZH — 已達使用上限', () => {
      expect(couponMaxUsesMessage(Language.ZH_HK)).toContain('上限')
    })
  })

  describe('couponAlreadyUsedMessage', () => {
    it('EN — "already used"', () => {
      expect(couponAlreadyUsedMessage(Language.EN).toLowerCase()).toContain(
        'already used'
      )
    })

    it('ZH — 已被使用', () => {
      expect(couponAlreadyUsedMessage(Language.ZH_HK)).toMatch(/已被使用|已使用/)
    })
  })

  describe('couponSuccessMessage', () => {
    it('percent discount EN — mentions percent off', () => {
      const text = couponSuccessMessage(Language.EN, {
        discountType: 'percentage',
        discountValue: 10,
      })
      expect(text).toContain('10%')
      expect(text.toLowerCase()).toContain('off')
    })

    it('percent discount ZH — mentions % and 折扣', () => {
      const text = couponSuccessMessage(Language.ZH_HK, {
        discountType: 'percentage',
        discountValue: 10,
      })
      expect(text).toContain('10%')
      expect(text).toMatch(/折扣|優惠/)
    })

    it('fixed discount EN — mentions $ amount off', () => {
      const text = couponSuccessMessage(Language.EN, {
        discountType: 'fixed_amount',
        discountValue: 50,
      })
      expect(text).toContain('$50')
      expect(text.toLowerCase()).toContain('off')
    })

    it('fixed discount ZH — mentions $ amount', () => {
      const text = couponSuccessMessage(Language.ZH_HK, {
        discountType: 'fixed_amount',
        discountValue: 50,
      })
      expect(text).toContain('$50')
    })

    it('generic (no discount metadata) EN — generic redemption line', () => {
      const text = couponSuccessMessage(Language.EN, {
        discountType: null,
        discountValue: null,
      })
      expect(text.toLowerCase()).toContain('redeemed')
    })

    it('generic (no discount metadata) ZH — generic redemption line', () => {
      const text = couponSuccessMessage(Language.ZH_HK, {
        discountType: null,
        discountValue: null,
      })
      expect(text).toContain('優惠券')
      expect(text).toMatch(/兌換/)
    })

    it('percentage with null discountValue falls through to generic', () => {
      const text = couponSuccessMessage(Language.EN, {
        discountType: 'percentage',
        discountValue: null,
      })
      expect(text).not.toContain('%')
      expect(text.toLowerCase()).toContain('redeemed')
    })
  })
})
