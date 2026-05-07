import type { LanguageCode } from '@/domain/value-objects/language'

/**
 * Compute the legacy `template` column value for CREATE. Mirrors the PATCH
 * derivation so rolling-deploy readers don't see the wrong language or an
 * empty string when the admin only filled one language.
 */
export function resolveLegacyTemplate(
  parsed: { template: string; templateEn: string | null; templateZhHk: string | null },
  defaultLang: LanguageCode
): string {
  const explicit = normalize(parsed.template)
  const en = normalize(parsed.templateEn)
  const zhHk = normalize(parsed.templateZhHk)
  const derived = defaultLang === 'en' ? (en ?? zhHk) : (zhHk ?? en)
  return explicit ?? derived ?? ''
}

function normalize(value: string | null | undefined): string | null {
  return value && value.trim() !== '' ? value : null
}
