import {
  createCampaign,
  findExistingPausedWelcome,
  remapWelcomeCampaign,
  updateCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { buildDefaultWelcomeCampaign } from './build-default-welcome-campaign'

export interface SeedDefaultWelcomeCampaignResult {
  campaignId: string
}

/**
 * Idempotent seeder for a restaurant's default welcome campaign.
 *
 * Two short-circuit guards (in order):
 *   1. If a welcome campaign is already mapped, return its id.
 *   2. If a previous attempt left a PAUSED welcome row behind (remap
 *      failed mid-seed), reuse that row instead of creating a new one.
 *      This prevents orphan accumulation across retries — the seeder
 *      always converges on a single welcome row per restaurant.
 *
 * Flow when neither guard fires:
 *   createCampaign(status: 'paused') → remapWelcomeCampaign → updateCampaign(status: 'active')
 *
 * The PAUSED intermediate state is the safety net for the partial-unique
 * index on (restaurant_id, type) WHERE status = 'active' — paused rows
 * never collide with the constraint, so a concurrent or retried seed is
 * safe.
 *
 * The remap RPC is the only path that flips `is_chargeable = false`;
 * welcome campaigns must never bill.
 *
 * If the remap throws, we propagate the error naturally. The paused row
 * stays as a reusable seed for the next retry — no orphan accumulation,
 * no leaked active row.
 */
export async function seedDefaultWelcomeCampaign(
  restaurantId: string
): Promise<SeedDefaultWelcomeCampaignResult> {
  const settings = await getOnboardingSettings(restaurantId)
  if (settings.welcomeCampaignId) {
    return { campaignId: settings.welcomeCampaignId }
  }

  const existingPaused = await findExistingPausedWelcome(restaurantId)
  const campaignId = existingPaused
    ? existingPaused.id
    : await createPausedWelcomeFor(restaurantId, settings.defaultLanguage)

  await remapWelcomeCampaign(restaurantId, null, campaignId)
  await updateCampaign(campaignId, { status: 'active' })
  return { campaignId }
}

async function createPausedWelcomeFor(
  restaurantId: string,
  defaultLanguage: 'en' | 'zh_hk'
): Promise<string> {
  const fixture = buildDefaultWelcomeCampaign({ restaurantId })
  // Respect tenant default language for the legacy single-column
  // `template` snapshot. Older readers fall back to that column.
  const legacyTemplate =
    defaultLanguage === 'en' ? fixture.templateEn : fixture.templateZhHk

  const campaign = await createCampaign({
    restaurantId: fixture.restaurantId,
    name: fixture.name,
    type: fixture.type,
    legacyTemplate,
    templateEn: fixture.templateEn,
    templateZhHk: fixture.templateZhHk,
    couponConfig: fixture.couponConfig,
    // Created paused so the active partial-unique index can't trip on a
    // concurrent or retried seed. Activated only after remap succeeds.
    status: 'paused',
  })
  return campaign.id
}
