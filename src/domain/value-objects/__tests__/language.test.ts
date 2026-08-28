import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'

describe('Language value object', () => {
  describe('singletons', () => {
    it('exposes EN and ZH_HK as singleton instances', () => {
      expect(Language.EN).toBeInstanceOf(Language)
      expect(Language.ZH_HK).toBeInstanceOf(Language)
    })

    it('has stable code values', () => {
      expect(Language.EN.code).toBe('en')
      expect(Language.ZH_HK.code).toBe('zh_hk')
    })

    it('returns the same instance every access', () => {
      expect(Language.EN).toBe(Language.EN)
      expect(Language.ZH_HK).toBe(Language.ZH_HK)
    })
  })

  describe('of', () => {
    it('returns EN for "en"', () => {
      expect(Language.of('en')).toBe(Language.EN)
    })

    it('returns ZH_HK for "zh_hk"', () => {
      expect(Language.of('zh_hk')).toBe(Language.ZH_HK)
    })

    it('throws for unknown codes', () => {
      expect(() => Language.of('fr')).toThrow()
      expect(() => Language.of('')).toThrow()
      expect(() => Language.of('EN')).toThrow()
    })
  })

  describe('fromCodeOrDefault', () => {
    it('returns Language for valid code', () => {
      expect(Language.fromCodeOrDefault('en', Language.ZH_HK)).toBe(Language.EN)
      expect(Language.fromCodeOrDefault('zh_hk', Language.EN)).toBe(Language.ZH_HK)
    })

    it('returns fallback for null/undefined', () => {
      expect(Language.fromCodeOrDefault(null, Language.ZH_HK)).toBe(Language.ZH_HK)
      expect(Language.fromCodeOrDefault(undefined, Language.EN)).toBe(Language.EN)
    })

    it('returns fallback for unknown code', () => {
      expect(Language.fromCodeOrDefault('fr', Language.ZH_HK)).toBe(Language.ZH_HK)
      expect(Language.fromCodeOrDefault('', Language.EN)).toBe(Language.EN)
    })
  })

  describe('default', () => {
    it('returns ZH_HK', () => {
      expect(Language.default()).toBe(Language.ZH_HK)
    })
  })

  describe('equals', () => {
    it('is true for same language', () => {
      expect(Language.EN.equals(Language.EN)).toBe(true)
      expect(Language.ZH_HK.equals(Language.ZH_HK)).toBe(true)
    })

    it('is false for different languages', () => {
      expect(Language.EN.equals(Language.ZH_HK)).toBe(false)
      expect(Language.ZH_HK.equals(Language.EN)).toBe(false)
    })
  })

  describe('other', () => {
    it('returns ZH_HK for EN', () => {
      expect(Language.EN.other()).toBe(Language.ZH_HK)
    })

    it('returns EN for ZH_HK', () => {
      expect(Language.ZH_HK.other()).toBe(Language.EN)
    })
  })
})
