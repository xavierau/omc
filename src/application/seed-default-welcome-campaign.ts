import {
  createCampaign,
  remapWelcomeCampaign,
  updateCampaign,
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
 *
 * Atomicity (CodeRabbit follow-up): the campaign is created with
 * `status: 'paused'` first so it does NOT collide with the partial-unique
 * index on (restaurant_id, type) WHERE status = 'active'. Only after the
 * remap RPC succeeds do we flip the campaign to 'active'. If the remap
 * fails, the orphan paused row is best-effort deleted via an `updateCampaign`
 * to a terminal status; we cannot DELETE because the repo doesn't expose it,
 * so we leave the paused row (it won't trigger the active partial unique).
 */
export async function seedDefaultWelcomeCampaign(
  restaurantId: string
): Promise<SeedDefaultWelcomeCampaignResult> {
  const settings = await getOnboardingSettings(restaurantId)
  if (settings.welcomeCampaignId) {
    return { campaignId: settings.welcomeCampaignId }
  }

  const fixture = buildDefaultWelcomeCampaign({ restaurantId })
  // Respect tenant's default language for the legacy single-column
  // `template` snapshot. Older readers fall back to that column.
  const legacyTemplate =
    settings.defaultLanguage === 'en' ? fixture.templateEn : fixture.templateZhHk

  const campaign = await createCampaign({
    restaurantId: fixture.restaurantId,
    name: fixture.name,
    type: fixture.type,
    legacyTemplate,
    templateEn: fixture.templateEn,
    templateZhHk: fixture.templateZhHk,
    couponConfig: fixture.couponConfig,
    // Created paused so the active partial-unique index can't trip if a
    // concurrent seed call races us. Flipped to 'active' only after the
    // remap RPC succeeds.
    status: 'paused',
  })

  try {
    await remapWelcomeCampaign(restaurantId, null, campaign.id)
  } catch (err) {
    // Best-effort: leave the paused orphan in place (no DELETE in repo).
    // The paused status keeps it out of the active partial-unique index,
    // so a subsequent retry can still seed cleanly.
    throw err
  }

  await updateCampaign(campaign.id, { status: 'active' })
  return { campaignId: campaign.id }
}
