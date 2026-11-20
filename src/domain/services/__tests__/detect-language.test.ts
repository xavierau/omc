import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import { detectLanguageFromText } from '@/domain/services/detect-language'

describe('detectLanguageFromText', () => {
  it('detects Han (Traditional Chinese) as ZH_HK', () => {
    expect(detectLanguageFromText('你好')).toBe(Language.ZH_HK)
  })

  it('detects Han (Simplified Chinese) as ZH_HK', () => {
    expect(detectLanguageFromText('你好世界')).toBe(Language.ZH_HK)
  })

  it('detects Hiragana as ZH_HK', () => {
    expect(detectLanguageFromText('こんにちは')).toBe(Language.ZH_HK)
  })

  it('detects Katakana as ZH_HK', () => {
    expect(detectLanguageFromText('カタカナ')).toBe(Language.ZH_HK)
  })

  it('mixed English + Chinese returns ZH_HK (CJK wins)', () => {
    expect(detectLanguageFromText('hello 你好')).toBe(Language.ZH_HK)
  })

  it('detects pure English letters as EN', () => {
    expect(detectLanguageFromText('hello world')).toBe(Language.EN)
  })

  it('detects single English word as EN', () => {
    expect(detectLanguageFromText('JOIN')).toBe(Language.EN)
  })

  it('returns null for digits only', () => {
    expect(detectLanguageFromText('12345')).toBeNull()
  })

  it('returns null for symbols only', () => {
    expect(detectLanguageFromText('!!!???...')).toBeNull()
  })

  it('returns null for emoji only', () => {
    expect(detectLanguageFromText('😀🎉👍')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(detectLanguageFromText('')).toBeNull()
  })

  it('returns null for whitespace only', () => {
    expect(detectLanguageFromText('   \t\n  ')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(detectLanguageFromText(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(detectLanguageFromText(undefined)).toBeNull()
  })

  it('trims surrounding whitespace before deciding', () => {
    expect(detectLanguageFromText('  hello  ')).toBe(Language.EN)
  })

  it('returns null for Cyrillic-only text (non-Latin, non-CJK)', () => {
    expect(detectLanguageFromText('Привет')).toBeNull()
  })

  it('returns null for Arabic-only text (non-Latin, non-CJK)', () => {
    expect(detectLanguageFromText('مرحبا')).toBeNull()
  })

  it('returns null for Korean-only text (non-Latin, non-CJK)', () => {
    expect(detectLanguageFromText('안녕')).toBeNull()
  })

  it('returns null for Thai-only text (non-Latin, non-CJK)', () => {
    expect(detectLanguageFromText('สวัสดี')).toBeNull()
  })
})
