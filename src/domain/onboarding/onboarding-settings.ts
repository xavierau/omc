import type { LanguageCode } from '@/domain/value-objects/language'

export interface OnboardingSettings {
  welcomeCampaignId: string | null
  /**
   * Legacy single-value template kept in the READ model for rolling-deploy
   * compatibility. The editor never writes this field; it writes the bilingual
   * pair below. Will be dropped in ONBOARD-005b.
   */
  returningMemberTemplate: string | null
  returningMemberTemplateEn: string | null
  returningMemberTemplateZhHk: string | null
  defaultLanguage: LanguageCode
}

export interface OnboardingDraft {
  welcomeCampaignId: string
  returningMemberTemplateEn: string
  returningMemberTemplateZhHk: string
  defaultLanguage: LanguageCode
}

export type OnboardingPatch = Partial<
  Pick<
    OnboardingSettings,
    | 'welcomeCampaignId'
    | 'returningMemberTemplateEn'
    | 'returningMemberTemplateZhHk'
    | 'defaultLanguage'
  >
>

export const MAX_TEMPLATE_LENGTH = 1024
export const CHAR_WARN_THRESHOLD = 900

const SUPPORTED_LANGUAGES: readonly LanguageCode[] = ['en', 'zh_hk']

function asLanguageCode(value: unknown): LanguageCode {
  return SUPPORTED_LANGUAGES.includes(value as LanguageCode)
    ? (value as LanguageCode)
    : 'zh_hk'
}

export function toDraft(settings: OnboardingSettings): OnboardingDraft {
  return {
    welcomeCampaignId: settings.welcomeCampaignId ?? '',
    returningMemberTemplateEn: settings.returningMemberTemplateEn ?? '',
    returningMemberTemplateZhHk: settings.returningMemberTemplateZhHk ?? '',
    defaultLanguage: asLanguageCode(settings.defaultLanguage),
  }
}

// Trim is used only to detect "effectively empty" input and collapse it to
// null; the returned value is the ORIGINAL (untrimmed) so intentional leading
// or trailing whitespace entered by the admin is preserved on save.
function normalizeNullable(value: string): string | null {
  return value.trim() === '' ? null : value
}

export function isDirty(
  settings: OnboardingSettings,
  draft: OnboardingDraft
): boolean {
  return (
    normalizeNullable(draft.welcomeCampaignId) !== settings.welcomeCampaignId ||
    normalizeNullable(draft.returningMemberTemplateEn) !==
      settings.returningMemberTemplateEn ||
    normalizeNullable(draft.returningMemberTemplateZhHk) !==
      settings.returningMemberTemplateZhHk ||
    draft.defaultLanguage !== settings.defaultLanguage
  )
}

export function computePatch(
  settings: OnboardingSettings,
  draft: OnboardingDraft
): OnboardingPatch {
  const patch: OnboardingPatch = {}
  const nextCampaign = normalizeNullable(draft.welcomeCampaignId)
  if (nextCampaign !== settings.welcomeCampaignId) {
    patch.welcomeCampaignId = nextCampaign
  }
  const nextEn = normalizeNullable(draft.returningMemberTemplateEn)
  if (nextEn !== settings.returningMemberTemplateEn) {
    patch.returningMemberTemplateEn = nextEn
  }
  const nextZh = normalizeNullable(draft.returningMemberTemplateZhHk)
  if (nextZh !== settings.returningMemberTemplateZhHk) {
    patch.returningMemberTemplateZhHk = nextZh
  }
  if (draft.defaultLanguage !== settings.defaultLanguage) {
    patch.defaultLanguage = draft.defaultLanguage
  }
  return patch
}

export function insertAtCursor(
  value: string,
  cursor: number,
  token: string
): { value: string; cursor: number } {
  const safeCursor = Math.max(0, Math.min(cursor, value.length))
  const before = value.slice(0, safeCursor)
  const after = value.slice(safeCursor)
  return {
    value: `${before}${token}${after}`,
    cursor: safeCursor + token.length,
  }
}

export function shouldWarnCharCount(count: number): boolean {
  return count > CHAR_WARN_THRESHOLD
}

export interface CampaignLike {
  templateEn?: string | null
  templateZhHk?: string | null
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === ''
}

export function missingCampaignLanguages(
  campaign: CampaignLike
): LanguageCode[] {
  const missing: LanguageCode[] = []
  if (isBlank(campaign.templateEn)) missing.push('en')
  if (isBlank(campaign.templateZhHk)) missing.push('zh_hk')
  return missing
}
