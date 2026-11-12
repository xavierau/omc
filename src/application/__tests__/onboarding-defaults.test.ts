import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import {
  defaultWelcomeText,
  defaultReturningText,
  minimalWelcomeText,
  defaultCouponCaptionSuffix,
} from '../onboarding-defaults'

describe('onboarding-defaults bilingual copy', () => {
  describe('defaultWelcomeText', () => {
    it('English includes program greeting, code, and POINTS instruction', () => {
      const text = defaultWelcomeText(Language.EN, 'Alice', 'ABC123')
      expect(text).toContain('Welcome')
      expect(text).toContain('Alice')
      expect(text).toContain('ABC123')
      expect(text).toContain('POINTS')
    })

    it('English omits name when contactName missing', () => {
      const text = defaultWelcomeText(Language.EN, undefined, 'ABC123')
      expect(text).not.toContain('undefined')
      expect(text).toContain('ABC123')
    })

    it('Traditional Chinese uses 繁體 characters and includes code', () => {
      const text = defaultWelcomeText(Language.ZH_HK, 'Alice', 'ABC123')
      expect(text).toContain('歡迎')
      expect(text).toContain('Alice')
      expect(text).toContain('ABC123')
      expect(text).toContain('POINTS')
    })
  })

  describe('defaultReturningText', () => {
    it('English includes greeting and points', () => {
      const text = defaultReturningText(Language.EN, 'Welcome back, Alice!', 42)
      expect(text).toContain('Welcome back, Alice!')
      expect(text).toContain('42')
      expect(text).toContain('points')
    })

    it('Traditional Chinese includes greeting and points with 積分', () => {
      const text = defaultReturningText(Language.ZH_HK, '歡迎回來', 42)
      expect(text).toContain('歡迎回來')
      expect(text).toContain('42')
      expect(text).toContain('積分')
    })
  })

  describe('minimalWelcomeText', () => {
    it('English includes code', () => {
      const text = minimalWelcomeText(Language.EN, 'ABC123')
      expect(text).toContain('ABC123')
      expect(text).toContain('Welcome')
    })

    it('Traditional Chinese includes code', () => {
      const text = minimalWelcomeText(Language.ZH_HK, 'ABC123')
      expect(text).toContain('ABC123')
      expect(text).toContain('歡迎')
    })
  })

  describe('defaultCouponCaptionSuffix', () => {
    it('English mentions staff and the code', () => {
      const text = defaultCouponCaptionSuffix(Language.EN, 'ABC123')
      expect(text).toContain('ABC123')
      expect(text.toLowerCase()).toMatch(/staff|redeem/)
    })

    it('Traditional Chinese mentions staff and the code', () => {
      const text = defaultCouponCaptionSuffix(Language.ZH_HK, 'ABC123')
      expect(text).toContain('ABC123')
      expect(text).toMatch(/職員|員工|兌換/)
    })
  })
})
