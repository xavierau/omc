export interface OnboardingSettings {
  welcomeCampaignId: string | null
  returningMemberTemplate: string | null
}

export interface OnboardingDraft {
  welcomeCampaignId: string
  returningMemberTemplate: string
}

export type OnboardingPatch = Partial<OnboardingSettings>

export const MAX_TEMPLATE_LENGTH = 1024
export const CHAR_WARN_THRESHOLD = 900

export function toDraft(settings: OnboardingSettings): OnboardingDraft {
  return {
    welcomeCampaignId: settings.welcomeCampaignId ?? '',
    returningMemberTemplate: settings.returningMemberTemplate ?? '',
  }
}

// Trim is used only to detect "effectively empty" input and collapse it to
// null; the returned value is the ORIGINAL (untrimmed) so intentional leading
// or trailing whitespace entered by the admin is preserved on save.
function normalizeNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : value
}

export function isDirty(settings: OnboardingSettings, draft: OnboardingDraft): boolean {
  const normalizedCampaign = normalizeNullable(draft.welcomeCampaignId)
  const normalizedTemplate = normalizeNullable(draft.returningMemberTemplate)
  return (
    normalizedCampaign !== settings.welcomeCampaignId ||
    normalizedTemplate !== settings.returningMemberTemplate
  )
}

export function computePatch(settings: OnboardingSettings, draft: OnboardingDraft): OnboardingPatch {
  const patch: OnboardingPatch = {}
  const nextCampaign = normalizeNullable(draft.welcomeCampaignId)
  if (nextCampaign !== settings.welcomeCampaignId) {
    patch.welcomeCampaignId = nextCampaign
  }
  const nextTemplate = normalizeNullable(draft.returningMemberTemplate)
  if (nextTemplate !== settings.returningMemberTemplate) {
    patch.returningMemberTemplate = nextTemplate
  }
  return patch
}

export function insertAtCursor(value: string, cursor: number, token: string): { value: string; cursor: number } {
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
