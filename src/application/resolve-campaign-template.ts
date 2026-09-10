import type { Campaign } from '@/domain/entities/campaign'
import type { OnboardingSettings } from '@/domain/onboarding/onboarding-settings'
import { Language } from '@/domain/value-objects/language'
import { resolveLocalizedTemplate } from '@/domain/services/resolve-localized-template'

/**
 * Bilingual resolver for campaign inline text. Picks preferred-language, then
 * the other language, then the legacy single-value column, then null.
 */
export function resolveCampaignTemplate(
  campaign: Campaign,
  preferred: Language
): string | null {
  return resolveLocalizedTemplate({
    en: campaign.templateEn,
    zhHk: campaign.templateZhHk,
    legacy: campaign.template,
    preferred,
  })
}

/**
 * Bilingual resolver for the restaurant-level returning-member template.
 * Same fallback chain as campaigns.
 */
export function resolveReturningMemberTemplate(
  settings: OnboardingSettings,
  preferred: Language
): string | null {
  return resolveLocalizedTemplate({
    en: settings.returningMemberTemplateEn,
    zhHk: settings.returningMemberTemplateZhHk,
    legacy: settings.returningMemberTemplate,
    preferred,
  })
}
