import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { MAX_TEMPLATE_LENGTH } from '@/domain/onboarding/onboarding-settings'
import type { UpdateCampaignParams } from '@/infrastructure/supabase/repositories/campaign-repository'
import type { Campaign } from '@/domain/entities/campaign'
import type { LanguageCode } from '@/domain/value-objects/language'

/**
 * Dual-write the legacy `template` column when the caller touches either
 * bilingual field. Resolve the chosen language from the restaurant's
 * `default_language`, falling back to the other language, then to the
 * existing legacy value. An explicit `template` in the patch takes
 * precedence and bypasses this derivation.
 */
export async function attachLegacyTemplateIfNeeded(
  changes: UpdateCampaignParams,
  existing: Campaign,
  restaurantId: string
): Promise<void> {
  if (changes.template !== undefined) return
  const enTouched = changes.templateEn !== undefined
  const zhTouched = changes.templateZhHk !== undefined
  if (!enTouched && !zhTouched) return

  const effectiveEn = enTouched
    ? normalize(changes.templateEn)
    : normalize(existing.templateEn)
  const effectiveZhHk = zhTouched
    ? normalize(changes.templateZhHk)
    : normalize(existing.templateZhHk)
  const lang: LanguageCode = await getRestaurantDefaultLanguage(restaurantId)
  const primary = lang === 'en' ? effectiveEn : effectiveZhHk
  const fallback = lang === 'en' ? effectiveZhHk : effectiveEn
  changes.legacyTemplate = primary ?? fallback ?? normalize(existing.template) ?? ''
}

function normalize(value: string | null | undefined): string | null {
  return value && value.trim() !== '' ? value : null
}

export function validateTemplateLengths(
  body: Record<string, unknown>
): string | null {
  for (const key of ['template', 'templateEn', 'templateZhHk'] as const) {
    const value = body[key]
    if (typeof value === 'string' && value.length > MAX_TEMPLATE_LENGTH) {
      return `${key} must be ${MAX_TEMPLATE_LENGTH} characters or fewer`
    }
  }
  return null
}
