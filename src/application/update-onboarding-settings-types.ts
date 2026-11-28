import type { LanguageCode } from '@/domain/value-objects/language'

export interface UpdateOnboardingInput {
  welcomeCampaignId?: string | null
  returningMemberTemplateEn?: string | null
  returningMemberTemplateZhHk?: string | null
  defaultLanguage?: LanguageCode
}
