import type { Language } from '@/domain/value-objects/language'

export interface ResolveLocalizedTemplateInput {
  en: string | null
  zhHk: string | null
  legacy?: string | null
  preferred: Language
}

/**
 * Fallback chain for bilingual template selection.
 *
 *   preferred language → the other language → legacy (single-value) → null
 *
 * Empty strings are normalized to null so a whitespace-free blank is treated
 * identically to a missing column. Kept pure (no IO) so it can be unit-tested
 * exhaustively and reused from any layer.
 */
export function resolveLocalizedTemplate(
  input: ResolveLocalizedTemplateInput
): string | null {
  const preferredValue = pickByLanguage(input, input.preferred)
  if (preferredValue !== null) return preferredValue

  const otherValue = pickByLanguage(input, input.preferred.other())
  if (otherValue !== null) return otherValue

  return normalize(input.legacy ?? null)
}

function pickByLanguage(
  input: ResolveLocalizedTemplateInput,
  language: Language
): string | null {
  const raw = language.code === 'en' ? input.en : input.zhHk
  return normalize(raw)
}

function normalize(value: string | null): string | null {
  if (value === null || value === '') return null
  return value
}
