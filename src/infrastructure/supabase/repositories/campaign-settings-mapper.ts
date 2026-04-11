import type { TenantCampaignSettings } from '@/domain/services/campaign-guardrails'

export interface CampaignSettingsRow {
  id: string
  restaurant_id: string
  monthly_send_limit: number
  daily_campaign_limit: number
  max_unsubscribe_rate: string
  campaign_paused: boolean
  paused_reason: string | null
  paused_at: string | null
  created_at: string
  updated_at: string
}

export function mapRowToSettings(
  row: CampaignSettingsRow
): TenantCampaignSettings {
  return {
    restaurantId: row.restaurant_id,
    monthlySendLimit: row.monthly_send_limit,
    dailyCampaignLimit: row.daily_campaign_limit,
    maxUnsubscribeRate: parseFloat(row.max_unsubscribe_rate),
    campaignPaused: row.campaign_paused,
    pausedReason: row.paused_reason ?? undefined,
    pausedAt: row.paused_at ? new Date(row.paused_at) : undefined,
  }
}

type SettingsUpdate = Partial<Omit<TenantCampaignSettings, 'restaurantId'>>

export function mapSettingsToUpsert(
  restaurantId: string,
  settings: SettingsUpdate
): Record<string, unknown> {
  const row: Record<string, unknown> = { restaurant_id: restaurantId }

  if (settings.monthlySendLimit !== undefined) {
    row.monthly_send_limit = settings.monthlySendLimit
  }
  if (settings.dailyCampaignLimit !== undefined) {
    row.daily_campaign_limit = settings.dailyCampaignLimit
  }
  if (settings.maxUnsubscribeRate !== undefined) {
    row.max_unsubscribe_rate = settings.maxUnsubscribeRate
  }
  if (settings.campaignPaused !== undefined) {
    row.campaign_paused = settings.campaignPaused
  }
  if (settings.pausedReason !== undefined) {
    row.paused_reason = settings.pausedReason ?? null
  }
  if (settings.pausedAt !== undefined) {
    row.paused_at = settings.pausedAt ? settings.pausedAt.toISOString() : null
  }

  return row
}
