import { remapWelcomeCampaign } from '@/infrastructure/supabase/repositories/campaign-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import type { Campaign } from '@/domain/entities/campaign'

/**
 * Mirror the POST auto-map behavior when PATCH flips a campaign's type.
 *
 * - promo/winback/birthday → welcome: route through the atomic RPC so the
 *   new campaign becomes the mapped welcome (is_chargeable=false) and the
 *   previously mapped welcome (if any) flips back to is_chargeable=true.
 *   GUARD: only auto-map when the effective status (patch status, or the
 *   existing campaign's status when the patch doesn't touch it) is 'active'.
 *   A paused/draft welcome campaign must never become the active welcome
 *   target — new members would otherwise route to a paused campaign.
 * - welcome → other: only clear the mapping when THIS campaign was the
 *   currently mapped welcome; otherwise the admin was just cleaning up an
 *   un-mapped leftover and nothing needs to change. Status is irrelevant
 *   here — unmap on any welcome-exit.
 *
 * Best-effort. A failure here does NOT block the PATCH response — the type
 * change has already persisted; the admin can retry mapping via the QR
 * setup picker.
 */
export async function cascadeCampaignTypeChange(args: {
  restaurantId: string
  campaignId: string
  previousType: Campaign['type']
  previousStatus: Campaign['status']
  nextType: Campaign['type'] | undefined
  nextStatus: Campaign['status'] | undefined
}): Promise<void> {
  const {
    restaurantId,
    campaignId,
    previousType,
    previousStatus,
    nextType,
    nextStatus,
  } = args
  if (nextType === undefined || nextType === previousType) return

  try {
    if (nextType === 'welcome') {
      const effectiveStatus = nextStatus ?? previousStatus
      if (effectiveStatus !== 'active') return
      const settings = await getOnboardingSettings(restaurantId)
      await remapWelcomeCampaign(
        restaurantId,
        settings.welcomeCampaignId,
        campaignId
      )
      return
    }
    if (previousType === 'welcome') {
      const settings = await getOnboardingSettings(restaurantId)
      if (settings.welcomeCampaignId === campaignId) {
        await remapWelcomeCampaign(restaurantId, campaignId, null)
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(
      `Campaign PATCH: welcome-type cascade failed for restaurant ${restaurantId}, campaign ${campaignId}: ${reason}`
    )
  }
}
