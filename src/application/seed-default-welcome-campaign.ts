import {
  createCampaign,
  remapWelcomeCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { buildDefaultWelcomeCampaign } from './build-default-welcome-campaign'

export interface SeedDefaultWelcomeCampaignResult {
  campaignId: string
}

/**
 * Idempotent: creates a default welcome campaign for a restaurant and maps
 * it as the active welcome campaign — but only when the restaurant has no
 * welcome campaign mapped yet. Safe to call on every tenant creation and
 * from the 031 backfill migration's application-side companion (if any).
 *
 * The mapping goes through `remapWelcomeCampaign` (not a direct UPDATE) so
 * the atomic RPC flips `campaigns.is_chargeable = false` on the new
 * campaign. Welcome campaigns must never bill.
 */
export async function seedDefaultWelcomeCampaign(
  restaurantId: string
): Promise<SeedDefaultWelcomeCampaignResult> {
  const settings = await getOnboardingSettings(restaurantId)
  if (settings.welcomeCampaignId) {
    return { campaignId: settings.welcomeCampaignId }
  }

  const fixture = buildDefaultWelcomeCampaign({ restaurantId })
  const campaign = await createCampaign({
    restaurantId: fixture.restaurantId,
    name: fixture.name,
    type: fixture.type,
    legacyTemplate: fixture.templateZhHk,
    templateEn: fixture.templateEn,
    templateZhHk: fixture.templateZhHk,
    couponConfig: fixture.couponConfig,
    status: fixture.status,
  })

  await remapWelcomeCampaign(restaurantId, null, campaign.id)
  return { campaignId: campaign.id }
}
