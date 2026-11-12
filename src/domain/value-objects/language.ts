/**
 * Language value object for bilingual template selection.
 *
 * Only Hong Kong market languages are supported today:
 *   - `en`    English
 *   - `zh_hk` Traditional Chinese (Hong Kong variant)
 *
 * The snake_case code `zh_hk` matches the DB column suffix convention
 * (e.g. `template_zh_hk`) and the Supabase CHECK constraint on
 * `restaurants.default_language`.
 */
export type LanguageCode = 'en' | 'zh_hk'

export class Language {
  static readonly EN: Language = new Language('en')
  static readonly ZH_HK: Language = new Language('zh_hk')

  private constructor(public readonly code: LanguageCode) {}

  static of(code: string): Language {
    if (code === 'en') return Language.EN
    if (code === 'zh_hk') return Language.ZH_HK
    throw new Error(`Unknown language code: ${code}`)
  }

  static fromCodeOrDefault(
    code: string | null | undefined,
    fallback: Language
  ): Language {
    if (code === 'en') return Language.EN
    if (code === 'zh_hk') return Language.ZH_HK
    return fallback
  }

  static default(): Language {
    return Language.ZH_HK
  }

  equals(other: Language): boolean {
    return this.code === other.code
  }

  other(): Language {
    return this.code === 'en' ? Language.ZH_HK : Language.EN
  }
}
