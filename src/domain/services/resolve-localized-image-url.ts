import type { Language } from '@/domain/value-objects/language'

export interface ResolveLocalizedImageUrlInput {
  en: string | null
  zhHk: string | null
  preferred: Language
}

/**
 * STRICT per-language image resolver. Unlike `resolveLocalizedTemplate`,
 * this does NOT fall back across languages: if the member's preferred
 * language has no image, the caller should fall through to the text-only
 * welcome path rather than showing the other language's image.
 *
 * Empty strings are normalized to null so a whitespace-free blank is
 * treated identically to a missing column.
 */
export function resolveLocalizedImageUrl(
  input: ResolveLocalizedImageUrlInput
): string | null {
  const raw = input.preferred.code === 'en' ? input.en : input.zhHk
  return normalize(raw)
}

function normalize(value: string | null): string | null {
  if (value === null || value === '') return null
  return value
}
