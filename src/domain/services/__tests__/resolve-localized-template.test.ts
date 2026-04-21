import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import { resolveLocalizedTemplate } from '@/domain/services/resolve-localized-template'

describe('resolveLocalizedTemplate', () => {
  it('returns preferred when all four sources populated', () => {
    const result = resolveLocalizedTemplate({
      en: 'EN',
      zhHk: 'ZH',
      legacy: 'LEG',
      preferred: Language.EN,
    })
    expect(result).toBe('EN')
  })

  it('returns preferred zh when preferred is ZH_HK and all populated', () => {
    const result = resolveLocalizedTemplate({
      en: 'EN',
      zhHk: 'ZH',
      legacy: 'LEG',
      preferred: Language.ZH_HK,
    })
    expect(result).toBe('ZH')
  })

  it('falls back to other language when preferred is null', () => {
    expect(
      resolveLocalizedTemplate({
        en: null,
        zhHk: 'ZH',
        legacy: null,
        preferred: Language.EN,
      })
    ).toBe('ZH')
  })

  it('falls back to other language when preferred is empty string', () => {
    expect(
      resolveLocalizedTemplate({
        en: '',
        zhHk: 'ZH',
        legacy: 'LEG',
        preferred: Language.EN,
      })
    ).toBe('ZH')
  })

  it('falls back to legacy when both language fields are null', () => {
    expect(
      resolveLocalizedTemplate({
        en: null,
        zhHk: null,
        legacy: 'LEG',
        preferred: Language.EN,
      })
    ).toBe('LEG')
  })

  it('falls back to legacy when both language fields are empty', () => {
    expect(
      resolveLocalizedTemplate({
        en: '',
        zhHk: '',
        legacy: 'LEG',
        preferred: Language.ZH_HK,
      })
    ).toBe('LEG')
  })

  it('returns null when everything is null', () => {
    expect(
      resolveLocalizedTemplate({
        en: null,
        zhHk: null,
        legacy: null,
        preferred: Language.EN,
      })
    ).toBeNull()
  })

  it('returns null when everything is empty string', () => {
    expect(
      resolveLocalizedTemplate({
        en: '',
        zhHk: '',
        legacy: '',
        preferred: Language.ZH_HK,
      })
    ).toBeNull()
  })

  it('treats undefined legacy as null', () => {
    expect(
      resolveLocalizedTemplate({
        en: null,
        zhHk: null,
        preferred: Language.EN,
      })
    ).toBeNull()
  })

  it('returns only-preferred when it is the sole non-empty', () => {
    expect(
      resolveLocalizedTemplate({
        en: 'EN',
        zhHk: null,
        legacy: null,
        preferred: Language.EN,
      })
    ).toBe('EN')
  })

  it('returns only-other when only other is populated', () => {
    expect(
      resolveLocalizedTemplate({
        en: null,
        zhHk: 'ZH',
        legacy: null,
        preferred: Language.EN,
      })
    ).toBe('ZH')
  })

  it('returns only-legacy when only legacy is populated', () => {
    expect(
      resolveLocalizedTemplate({
        en: null,
        zhHk: null,
        legacy: 'LEG',
        preferred: Language.ZH_HK,
      })
    ).toBe('LEG')
  })

  it('never falls past preferred when preferred is non-empty', () => {
    expect(
      resolveLocalizedTemplate({
        en: 'EN',
        zhHk: null,
        legacy: 'LEG',
        preferred: Language.EN,
      })
    ).toBe('EN')
  })
})
