import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import { parseLanguageCommand } from '@/domain/services/parse-language-command'

describe('parseLanguageCommand', () => {
  describe('English commands', () => {
    it('parses LANG EN → EN', () => {
      expect(parseLanguageCommand('LANG EN')).toBe(Language.EN)
    })

    it('parses lang en (lowercase) → EN', () => {
      expect(parseLanguageCommand('lang en')).toBe(Language.EN)
    })

    it('parses LaNg En (mixed case) → EN', () => {
      expect(parseLanguageCommand('LaNg En')).toBe(Language.EN)
    })

    it('parses " LANG EN " (leading/trailing whitespace) → EN', () => {
      expect(parseLanguageCommand(' LANG EN ')).toBe(Language.EN)
    })

    it('parses "LANG  EN" (multiple spaces) → EN', () => {
      expect(parseLanguageCommand('LANG  EN')).toBe(Language.EN)
    })

    it('parses LANG ZH → ZH_HK', () => {
      expect(parseLanguageCommand('LANG ZH')).toBe(Language.ZH_HK)
    })

    it('parses lang zh (lowercase) → ZH_HK', () => {
      expect(parseLanguageCommand('lang zh')).toBe(Language.ZH_HK)
    })
  })

  describe('Chinese commands', () => {
    it('parses 語言 英文 → EN', () => {
      expect(parseLanguageCommand('語言 英文')).toBe(Language.EN)
    })

    it('parses 語言 中文 → ZH_HK', () => {
      expect(parseLanguageCommand('語言 中文')).toBe(Language.ZH_HK)
    })

    it('parses " 語言 英文 " (surrounding whitespace) → EN', () => {
      expect(parseLanguageCommand(' 語言 英文 ')).toBe(Language.EN)
    })

    it('parses "語言  中文" (multiple spaces) → ZH_HK', () => {
      expect(parseLanguageCommand('語言  中文')).toBe(Language.ZH_HK)
    })

    it('parses 语言 英文 (Simplified 语) → EN', () => {
      expect(parseLanguageCommand('语言 英文')).toBe(Language.EN)
    })

    it('parses 语言 中文 (Simplified 语) → ZH_HK', () => {
      expect(parseLanguageCommand('语言 中文')).toBe(Language.ZH_HK)
    })

    it('parses " 语言  英文 " (Simplified with extra whitespace) → EN', () => {
      expect(parseLanguageCommand(' 语言  英文 ')).toBe(Language.EN)
    })
  })

  describe('non-command input', () => {
    it('returns null for LANG FR (unsupported language)', () => {
      expect(parseLanguageCommand('LANG FR')).toBeNull()
    })

    it('returns null for JOIN keyword', () => {
      expect(parseLanguageCommand('JOIN')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseLanguageCommand('')).toBeNull()
    })

    it('returns null for null input', () => {
      expect(parseLanguageCommand(null)).toBeNull()
    })

    it('returns null for undefined input', () => {
      expect(parseLanguageCommand(undefined)).toBeNull()
    })

    it('returns null for whitespace only', () => {
      expect(parseLanguageCommand('   ')).toBeNull()
    })

    it('returns null for arbitrary Chinese text', () => {
      expect(parseLanguageCommand('你好')).toBeNull()
    })

    it('returns null for LANG alone (no argument)', () => {
      expect(parseLanguageCommand('LANG')).toBeNull()
    })
  })
})
