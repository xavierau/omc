import {
  getOnboardingSettings,
  updateOnboardingSettings,
  type OnboardingSettings,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  getCampaignById,
  remapWelcomeCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'

export class OnboardingSettingsError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message)
    this.name = 'OnboardingSettingsError'
  }
}

export interface UpdateOnboardingInput {
  welcomeCampaignId?: string | null
  returningMemberTemplate?: string | null
}

/**
 * Orchestrates an admin update to a restaurant's onboarding settings.
 *
 * When welcomeCampaignId changes, the mapping write and both
 * is_chargeable flips are executed in a single server-side Postgres
 * function (`remap_welcome_campaign`, migration 027) so a mid-sequence
 * failure cannot leave the mapping and the campaign flags inconsistent.
 *
 * When the returning-member template changes in the same PATCH, that
 * update is still a separate round-trip. The window is small, the caller
 * is an admin, and template drift has no billing impact — acceptable.
 *
 * Validates that the incoming welcomeCampaignId (when non-null) belongs
 * to the given restaurant — preventing cross-tenant mapping.
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
    if (input.returningMemberTemplate !== undefined) {
      await updateOnboardingSettings(restaurantId, {
        returningMemberTemplate: input.returningMemberTemplate,
      })
    }
  } else {
    await updateOnboardingSettings(restaurantId, input)
  }

  return {
    welcomeCampaignId:
      input.welcomeCampaignId !== undefined
        ? input.welcomeCampaignId
        : before.welcomeCampaignId,
    returningMemberTemplate:
      input.returningMemberTemplate !== undefined
        ? input.returningMemberTemplate
        : before.returningMemberTemplate,
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
  // Mapping a non-welcome (promo/winback) campaign would flip it to
  // is_chargeable=false and leak billing — reject it.
  if (campaign.type !== 'welcome') {
    throw new OnboardingSettingsError(
      'only welcome-type campaigns may be mapped',
      400
    )
  }
}
