import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import { resolveLocalizedImageUrl } from '@/domain/services/resolve-localized-image-url'

describe('resolveLocalizedImageUrl', () => {
  it('returns EN image when EN preferred and EN is present', () => {
    expect(
      resolveLocalizedImageUrl({
        en: 'https://cdn.test/en.png',
        zhHk: 'https://cdn.test/zh.png',
        preferred: Language.EN,
      })
    ).toBe('https://cdn.test/en.png')
  })

  it('returns null when EN preferred but only ZH is present (STRICT — no fallback)', () => {
    expect(
      resolveLocalizedImageUrl({
        en: null,
        zhHk: 'https://cdn.test/zh.png',
        preferred: Language.EN,
      })
    ).toBeNull()
  })

  it('returns ZH image when ZH preferred and ZH is present', () => {
    expect(
      resolveLocalizedImageUrl({
        en: 'https://cdn.test/en.png',
        zhHk: 'https://cdn.test/zh.png',
        preferred: Language.ZH_HK,
      })
    ).toBe('https://cdn.test/zh.png')
  })

  it('returns null when ZH preferred but only EN is present (STRICT — no fallback)', () => {
    expect(
      resolveLocalizedImageUrl({
        en: 'https://cdn.test/en.png',
        zhHk: null,
        preferred: Language.ZH_HK,
      })
    ).toBeNull()
  })

  it('returns null when both are null', () => {
    expect(
      resolveLocalizedImageUrl({
        en: null,
        zhHk: null,
        preferred: Language.EN,
      })
    ).toBeNull()
  })

  it('treats empty string as missing (strict-match, same normalization)', () => {
    expect(
      resolveLocalizedImageUrl({
        en: '',
        zhHk: 'https://cdn.test/zh.png',
        preferred: Language.EN,
      })
    ).toBeNull()
  })
})
