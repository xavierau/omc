import { upsertSettings } from '@/infrastructure/supabase/repositories/campaign-settings-repository'

export async function pauseTenantCampaigns(
  restaurantId: string,
  reason: string
): Promise<void> {
  await upsertSettings(restaurantId, {
    campaignPaused: true,
    pausedReason: reason,
    pausedAt: new Date(),
  })
}
