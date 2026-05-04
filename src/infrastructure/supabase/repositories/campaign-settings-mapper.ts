import {
  DEFAULT_PER_USER_MARKETING_CAP,
  type TenantCampaignSettings,
} from '@/domain/services/campaign-guardrails'

export interface CampaignSettingsRow {
  id: string
  restaurant_id: string
  monthly_send_limit: number
  daily_campaign_limit: number
  max_unsubscribe_rate: string
  campaign_paused: boolean
  paused_reason: string | null
  paused_at: string | null
  // WAQ-007 — column added in migration 040 with default 1. Older tenant
  // rows that pre-date the migration won't have the column; the mapper
  // defends by defaulting to 1 so the gate stays safely-tight.
  per_user_marketing_cap?: number | null
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
    perUserMarketingCap:
      row.per_user_marketing_cap ?? DEFAULT_PER_USER_MARKETING_CAP,
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
  if (settings.perUserMarketingCap !== undefined) {
    row.per_user_marketing_cap = settings.perUserMarketingCap
  }

  return row
}
