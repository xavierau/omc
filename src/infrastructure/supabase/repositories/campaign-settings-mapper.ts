import {
  DEFAULT_PER_USER_MARKETING_CAP,
  DEFAULT_SETTINGS,
  type TenantCampaignSettings,
  type AutoPauseReason,
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
  // WAQ-009 — columns added in migration 042. Defaults applied on read so
  // pre-migration rows behave as "no auto-throttle, not auto-paused".
  auto_throttle_factor?: number | string | null
  auto_pause_active?: boolean | null
  auto_pause_reason?: string | null
  auto_pause_set_at?: string | null
  // WAQ-010 — columns added in migration 043. Defaults applied on read so
  // pre-migration rows fall back to the engagement_tier/100/100 baseline.
  pacing_strategy?: string | null
  probe_chunk_size?: number | null
  scale_chunk_size?: number | null
  active_hours_start_local?: string | null
  active_hours_end_local?: string | null
  tenant_timezone?: string | null
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
    autoThrottleFactor: parseAutoThrottle(row.auto_throttle_factor),
    autoPauseActive: row.auto_pause_active ?? false,
    autoPauseReason: (row.auto_pause_reason ?? null) as AutoPauseReason | null,
    autoPauseSetAt: row.auto_pause_set_at
      ? new Date(row.auto_pause_set_at)
      : null,
    pacingStrategy: parsePacingStrategy(row.pacing_strategy),
    probeChunkSize: row.probe_chunk_size ?? DEFAULT_SETTINGS.probeChunkSize,
    scaleChunkSize: row.scale_chunk_size ?? DEFAULT_SETTINGS.scaleChunkSize,
    activeHoursStartLocal:
      row.active_hours_start_local ?? DEFAULT_SETTINGS.activeHoursStartLocal,
    activeHoursEndLocal:
      row.active_hours_end_local ?? DEFAULT_SETTINGS.activeHoursEndLocal,
    tenantTimezone: row.tenant_timezone ?? DEFAULT_SETTINGS.tenantTimezone,
  }
}

// Defends the union: if the column ever drifts (manual SQL, restored row)
// the mapper falls back to the default rather than corrupting the type.
function parsePacingStrategy(
  v: string | null | undefined
): TenantCampaignSettings['pacingStrategy'] {
  if (v === 'naive') return 'naive'
  return DEFAULT_SETTINGS.pacingStrategy
}

// Postgres NUMERIC arrives as a string from PostgREST; integer literal 1
// becomes the JS number 1 from a JSON response. Defend against both.
function parseAutoThrottle(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 1
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : 1
}

type SettingsUpdate = Partial<Omit<TenantCampaignSettings, 'restaurantId'>>

// Identity transform — value passes through untouched (non-undefined only,
// undefined branches are gated by the caller).
const passthrough = (v: unknown): unknown => v
// Date | null transform — emits ISO string or null. Date is already filtered
// against undefined by the caller.
const dateOrNull = (v: unknown): unknown =>
  v instanceof Date ? v.toISOString() : null
// `pausedReason` historically coerced its undefined-equivalent (null) through
// `?? null`. The caller already gates on `!== undefined`, so we just return
// the value as-is — preserves the old "null stays null" behavior.
const stringOrNull = (v: unknown): unknown => v ?? null

const FIELD_MAP: ReadonlyArray<
  readonly [keyof SettingsUpdate, string, (v: unknown) => unknown]
> = [
  ['monthlySendLimit', 'monthly_send_limit', passthrough],
  ['dailyCampaignLimit', 'daily_campaign_limit', passthrough],
  ['maxUnsubscribeRate', 'max_unsubscribe_rate', passthrough],
  ['campaignPaused', 'campaign_paused', passthrough],
  ['pausedReason', 'paused_reason', stringOrNull],
  ['pausedAt', 'paused_at', dateOrNull],
  ['perUserMarketingCap', 'per_user_marketing_cap', passthrough],
  ['autoThrottleFactor', 'auto_throttle_factor', passthrough],
  ['autoPauseActive', 'auto_pause_active', passthrough],
  ['autoPauseReason', 'auto_pause_reason', passthrough],
  ['autoPauseSetAt', 'auto_pause_set_at', dateOrNull],
  ['pacingStrategy', 'pacing_strategy', passthrough],
  ['probeChunkSize', 'probe_chunk_size', passthrough],
  ['scaleChunkSize', 'scale_chunk_size', passthrough],
  ['activeHoursStartLocal', 'active_hours_start_local', passthrough],
  ['activeHoursEndLocal', 'active_hours_end_local', passthrough],
  ['tenantTimezone', 'tenant_timezone', passthrough],
]

export function mapSettingsToUpsert(
  restaurantId: string,
  settings: SettingsUpdate
): Record<string, unknown> {
  const row: Record<string, unknown> = { restaurant_id: restaurantId }
  for (const [src, dst, transform] of FIELD_MAP) {
    if (settings[src] !== undefined) row[dst] = transform(settings[src])
  }
  return row
}
