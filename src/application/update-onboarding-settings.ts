import {
  getOnboardingSettings,
  updateOnboardingSettings,
  type OnboardingSettings,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  getCampaignById,
  setCampaignChargeable,
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
 * Side effects when welcomeCampaignId changes:
 *   - The OLD welcome campaign (if any) is flipped back to is_chargeable=true.
 *   - The NEW welcome campaign is flipped to is_chargeable=false.
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

  await updateOnboardingSettings(restaurantId, input)

  if (campaignChanged) {
    await flipChargeabilityFlags(before.welcomeCampaignId, input.welcomeCampaignId ?? null)
  }

  return getOnboardingSettings(restaurantId)
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

async function flipChargeabilityFlags(
  previousId: string | null,
  nextId: string | null
): Promise<void> {
  if (previousId) {
    await setCampaignChargeable(previousId, true)
  }
  if (nextId) {
    await setCampaignChargeable(nextId, false)
  }
}
