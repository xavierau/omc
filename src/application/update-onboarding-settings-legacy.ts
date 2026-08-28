import type { OnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import type { UpdateOnboardingInput } from './update-onboarding-settings-types'

/**
 * Compute the legacy dual-write value from merged before+patch state. Returns
 * `undefined` (meaning "don't touch the legacy column") when no bilingual
 * field AND no default_language change are present in the patch — we only
 * re-write the legacy column when one of those three fields actually changes.
 *
 * The primary language is chosen by the effective `default_language`, with
 * the other bilingual field used as a fallback so the legacy column always
 * carries meaningful content when at least one bilingual field is set.
 */
export function computeLegacyReturningTemplate(
  before: OnboardingSettings,
  input: UpdateOnboardingInput
): string | null | undefined {
  const enTouched = input.returningMemberTemplateEn !== undefined
  const zhTouched = input.returningMemberTemplateZhHk !== undefined
  const langTouched = input.defaultLanguage !== undefined
  if (!enTouched && !zhTouched && !langTouched) return undefined

  const effectiveEn = enTouched
    ? input.returningMemberTemplateEn ?? null
    : before.returningMemberTemplateEn
  const effectiveZhHk = zhTouched
    ? input.returningMemberTemplateZhHk ?? null
    : before.returningMemberTemplateZhHk
  const effectiveLang = input.defaultLanguage ?? before.defaultLanguage
  const primary = effectiveLang === 'en' ? effectiveEn : effectiveZhHk
  const fallback = effectiveLang === 'en' ? effectiveZhHk : effectiveEn
  return primary ?? fallback ?? null
}
