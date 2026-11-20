import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'

describe('resolvePreferredLanguage', () => {
  it('returns restaurant default when member is null', () => {
    expect(
      resolvePreferredLanguage(null, { defaultLanguage: 'en' })
    ).toBe(Language.EN)
  })

  it('returns restaurant default when member.preferredLanguage is null', () => {
    expect(
      resolvePreferredLanguage(
        { preferredLanguage: null },
        { defaultLanguage: 'en' }
      )
    ).toBe(Language.EN)
  })

  it('returns EN when member preferred is en (overrides zh_hk default)', () => {
    expect(
      resolvePreferredLanguage(
        { preferredLanguage: 'en' },
        { defaultLanguage: 'zh_hk' }
      )
    ).toBe(Language.EN)
  })

  it('returns ZH_HK when member preferred is zh_hk (overrides en default)', () => {
    expect(
      resolvePreferredLanguage(
        { preferredLanguage: 'zh_hk' },
        { defaultLanguage: 'en' }
      )
    ).toBe(Language.ZH_HK)
  })

  it('falls back to restaurant default when member preferred is invalid', () => {
    expect(
      resolvePreferredLanguage(
        { preferredLanguage: 'xx' },
        { defaultLanguage: 'en' }
      )
    ).toBe(Language.EN)
  })

  it('falls back to Language.default() when both are invalid/null', () => {
    expect(
      resolvePreferredLanguage(
        { preferredLanguage: 'xx' },
        { defaultLanguage: null }
      )
    ).toBe(Language.default())
  })

  it('falls back to Language.default() when both member and restaurant.defaultLanguage are null', () => {
    expect(
      resolvePreferredLanguage(null, { defaultLanguage: null })
    ).toBe(Language.default())
  })
})
