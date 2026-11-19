// CAMP-016: the tenant's campaign audience defaults (migration 086 columns on
// tenant_campaign_settings). The 078 trigger seeds a row per tenant and the
// column defaults fill these two, so a missing row is an anomaly: it reads as
// the column defaults, and the first save re-seeds it the way 078 does (plan
// quota, never the 1,000 column default) before writing the two columns.
import { createServerSupabaseClient } from '../client'
import { getRestaurantPlan } from './restaurant-repository'
import { planCampaignQuota } from '@/domain/value-objects/tenant-plan'
import {
  DEFAULT_AUDIENCE_DEFAULTS,
  parseSkipContactQuality,
  type CampaignAudienceDefaults,
} from '@/domain/value-objects/audience-filters'

const TABLE = 'tenant_campaign_settings'
const COLUMNS = 'skip_contact_quality, lapsed_after_days'

interface Row {
  skip_contact_quality: string | null
  lapsed_after_days: number | null
}

function mapRow(row: Row | null): CampaignAudienceDefaults {
  if (!row) return { ...DEFAULT_AUDIENCE_DEFAULTS }
  return {
    skipContactQuality:
      parseSkipContactQuality(row.skip_contact_quality) ?? DEFAULT_AUDIENCE_DEFAULTS.skipContactQuality,
    lapsedAfterDays: row.lapsed_after_days ?? DEFAULT_AUDIENCE_DEFAULTS.lapsedAfterDays,
  }
}

export async function getAudienceDefaults(restaurantId: string): Promise<CampaignAudienceDefaults> {
  const { data, error } = await createServerSupabaseClient()
    .from(TABLE)
    .select(COLUMNS)
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw new Error(`getAudienceDefaults: ${error.message}`)
  return mapRow(data as Row | null)
}

/** Writes only these two columns; the guardrail columns are left as they are. */
export async function saveAudienceDefaults(
  restaurantId: string,
  defaults: CampaignAudienceDefaults
): Promise<CampaignAudienceDefaults> {
  const updated = await updateDefaults(restaurantId, defaults)
  if (updated) return mapRow(updated)
  await seedSettingsRow(restaurantId)
  const seeded = await updateDefaults(restaurantId, defaults)
  if (!seeded) throw new Error(`saveAudienceDefaults: no ${TABLE} row for ${restaurantId}`)
  return mapRow(seeded)
}

async function updateDefaults(restaurantId: string, defaults: CampaignAudienceDefaults): Promise<Row | null> {
  const { data, error } = await createServerSupabaseClient()
    .from(TABLE)
    .update({ skip_contact_quality: defaults.skipContactQuality, lapsed_after_days: defaults.lapsedAfterDays })
    .eq('restaurant_id', restaurantId)
    .select(COLUMNS)
  if (error) throw new Error(`saveAudienceDefaults: ${error.message}`)
  return ((data ?? []) as Row[])[0] ?? null
}

/**
 * The 078 seed for a row something deleted: the plan's quota (planCampaignQuota
 * mirrors plan_monthly_send_limit, contract-tested), other columns from their
 * definitions, and never an overwrite of a row a concurrent writer created.
 */
async function seedSettingsRow(restaurantId: string): Promise<void> {
  const plan = await getRestaurantPlan(restaurantId)
  if (!plan) throw new Error(`saveAudienceDefaults: restaurant ${restaurantId} not found`)
  const { error } = await createServerSupabaseClient()
    .from(TABLE)
    .upsert(
      { restaurant_id: restaurantId, monthly_send_limit: planCampaignQuota(plan) },
      { onConflict: 'restaurant_id', ignoreDuplicates: true }
    )
  if (error) throw new Error(`saveAudienceDefaults (seed): ${error.message}`)
  console.warn(`[CampaignSettings] ${TABLE} missing for tenant ${restaurantId}; re-seeded (plan=${plan}) — migration 078 should have seeded this row`)
}
