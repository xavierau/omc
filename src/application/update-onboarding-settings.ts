import {
  getOnboardingSettings,
  updateOnboardingSettings,
  type OnboardingSettings,
  type UpdateOnboardingSettingsChanges,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  getCampaignById,
  remapWelcomeCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import type { UpdateOnboardingInput } from './update-onboarding-settings-types'
import { computeLegacyReturningTemplate } from './update-onboarding-settings-legacy'

export type { UpdateOnboardingInput } from './update-onboarding-settings-types'

export class OnboardingSettingsError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message)
    this.name = 'OnboardingSettingsError'
  }
}

/**
 * Orchestrates an admin update to a restaurant's onboarding settings.
 *
 * The legacy single-value `returningMemberTemplate` field is no longer
 * accepted as input — the UI writes the bilingual pair. This use case
 * computes the correct legacy dual-write value from the merged before+patch
 * state (using the effective `defaultLanguage`) and passes it explicitly to
 * the repository so sparse patches can't silently corrupt the legacy column.
 */
export async function updateOnboardingSettingsForTenant(
  restaurantId: string,
  input: UpdateOnboardingInput
): Promise<OnboardingSettings> {
  await validateWelcomeCampaignOwnership(restaurantId, input.welcomeCampaignId)

  const before = await getOnboardingSettings(restaurantId)
  const campaignChanged =
    input.welcomeCampaignId !== undefined &&
    input.welcomeCampaignId !== before.welcomeCampaignId

  if (campaignChanged) {
    await remapWelcomeCampaign(
      restaurantId,
      before.welcomeCampaignId,
      input.welcomeCampaignId ?? null
    )
    const nonCampaign = extractNonCampaign(before, input)
    if (nonCampaign) {
      await updateOnboardingSettings(restaurantId, nonCampaign)
    }
  } else {
    await updateOnboardingSettings(
      restaurantId,
      buildRepoChanges(before, input)
    )
  }

  return mergeResult(before, input)
}

function extractNonCampaign(
  before: OnboardingSettings,
  input: UpdateOnboardingInput
): UpdateOnboardingSettingsChanges | null {
  const changes: UpdateOnboardingSettingsChanges = {}
  if (input.returningMemberTemplateEn !== undefined) {
    changes.returningMemberTemplateEn = input.returningMemberTemplateEn
  }
  if (input.returningMemberTemplateZhHk !== undefined) {
    changes.returningMemberTemplateZhHk = input.returningMemberTemplateZhHk
  }
  if (input.defaultLanguage !== undefined) {
    changes.defaultLanguage = input.defaultLanguage
  }
  const legacy = computeLegacyReturningTemplate(before, input)
  if (legacy !== undefined) changes.legacyReturningTemplate = legacy
  return Object.keys(changes).length > 0 ? changes : null
}

function buildRepoChanges(
  before: OnboardingSettings,
  input: UpdateOnboardingInput
): UpdateOnboardingSettingsChanges {
  const changes: UpdateOnboardingSettingsChanges = { ...input }
  const legacy = computeLegacyReturningTemplate(before, input)
  if (legacy !== undefined) changes.legacyReturningTemplate = legacy
  return changes
}

function mergeResult(
  before: OnboardingSettings,
  input: UpdateOnboardingInput
): OnboardingSettings {
  const en = input.returningMemberTemplateEn ?? before.returningMemberTemplateEn
  const zh =
    input.returningMemberTemplateZhHk ?? before.returningMemberTemplateZhHk
  const legacy = computeLegacyReturningTemplate(before, input)
  return {
    welcomeCampaignId:
      input.welcomeCampaignId !== undefined
        ? input.welcomeCampaignId
        : before.welcomeCampaignId,
    returningMemberTemplate:
      legacy !== undefined ? legacy : before.returningMemberTemplate,
    returningMemberTemplateEn: en,
    returningMemberTemplateZhHk: zh,
    defaultLanguage: input.defaultLanguage ?? before.defaultLanguage,
  }
}

async function validateWelcomeCampaignOwnership(
  restaurantId: string,
  welcomeCampaignId: string | null | undefined
): Promise<void> {
  if (welcomeCampaignId === undefined || welcomeCampaignId === null) return
  const campaign = await getCampaignById(welcomeCampaignId)
  if (!campaign) {
    throw new OnboardingSettingsError('welcome campaign not found', 400)
  }
  if (campaign.restaurantId !== restaurantId) {
    throw new OnboardingSettingsError(
      'welcome campaign does not belong to this tenant',
      403
    )
  }
  if (campaign.type !== 'welcome') {
    throw new OnboardingSettingsError(
      'only welcome-type campaigns may be mapped',
      400
    )
  }
}
