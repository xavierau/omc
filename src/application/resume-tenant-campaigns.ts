import { upsertSettings } from '@/infrastructure/supabase/repositories/campaign-settings-repository'

export async function resumeTenantCampaigns(
  restaurantId: string
): Promise<void> {
  await upsertSettings(restaurantId, {
    campaignPaused: false,
    pausedReason: null,
    pausedAt: null,
  })
}
