import { createServerSupabaseClient } from '../client'
import type { LanguageCode } from '@/domain/value-objects/language'

export interface OnboardingSettings {
  welcomeCampaignId: string | null
  returningMemberTemplate: string | null
  returningMemberTemplateEn: string | null
  returningMemberTemplateZhHk: string | null
  defaultLanguage: LanguageCode
}

const COLUMNS =
  'welcome_campaign_id, returning_member_template, returning_member_template_en, returning_member_template_zh_hk, default_language'

export async function getOnboardingSettings(
  restaurantId: string
): Promise<OnboardingSettings> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select(COLUMNS)
    .eq('id', restaurantId)
    .single()

  if (error || !data) {
    throw new Error(
      `getOnboardingSettings: restaurant not found (${restaurantId})`
    )
  }
  return mapRow(data as Record<string, unknown>)
}

export async function getRestaurantDefaultLanguage(
  restaurantId: string
): Promise<LanguageCode> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('default_language')
    .eq('id', restaurantId)
    .single()

  if (error || !data) return 'zh_hk'
  return normalizeLanguage(data.default_language)
}

/**
 * Partial update for onboarding settings. Repo is a dumb mapper: it writes
 * the legacy `returning_member_template` column only when the caller passes
 * an explicit `legacyReturningTemplate` value. The application layer owns
 * the derivation so sparse patches (only one language changed) can't collapse
 * the legacy column onto the wrong language's content.
 */
export interface UpdateOnboardingSettingsChanges
  extends Partial<OnboardingSettings> {
  /** Explicit value for the legacy `returning_member_template` column. */
  legacyReturningTemplate?: string | null
}

export async function updateOnboardingSettings(
  restaurantId: string,
  changes: UpdateOnboardingSettingsChanges
): Promise<void> {
  const update: Record<string, unknown> = {}
  if (changes.welcomeCampaignId !== undefined) {
    update.welcome_campaign_id = changes.welcomeCampaignId
  }
  if (changes.returningMemberTemplateEn !== undefined) {
    update.returning_member_template_en = changes.returningMemberTemplateEn
  }
  if (changes.returningMemberTemplateZhHk !== undefined) {
    update.returning_member_template_zh_hk =
      changes.returningMemberTemplateZhHk
  }
  if (changes.defaultLanguage !== undefined) {
    update.default_language = changes.defaultLanguage
  }
  if (changes.legacyReturningTemplate !== undefined) {
    update.returning_member_template = changes.legacyReturningTemplate
  }
  if (Object.keys(update).length === 0) return

  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('restaurants')
    .update(update)
    .eq('id', restaurantId)

  if (error) {
    throw new Error(`updateOnboardingSettings: ${error.message}`)
  }
}

function mapRow(row: Record<string, unknown>): OnboardingSettings {
  return {
    welcomeCampaignId: (row.welcome_campaign_id as string | null) ?? null,
    returningMemberTemplate:
      (row.returning_member_template as string | null) ?? null,
    returningMemberTemplateEn:
      (row.returning_member_template_en as string | null) ?? null,
    returningMemberTemplateZhHk:
      (row.returning_member_template_zh_hk as string | null) ?? null,
    defaultLanguage: normalizeLanguage(row.default_language),
  }
}

function normalizeLanguage(value: unknown): LanguageCode {
  return value === 'en' ? 'en' : 'zh_hk'
}
