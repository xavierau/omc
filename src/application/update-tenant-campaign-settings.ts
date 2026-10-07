import { upsertSettings } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import type { TenantCampaignSettings } from '@/domain/services/campaign-guardrails'

export interface UpdateSettingsInput {
  monthlySendLimit?: number
  dailyCampaignLimit?: number
  maxUnsubscribeRate?: number
}

export async function updateTenantCampaignSettings(
  restaurantId: string,
  input: UpdateSettingsInput
): Promise<TenantCampaignSettings> {
  return upsertSettings(restaurantId, input)
}
