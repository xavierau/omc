// CAMP-016: the tenant's campaign audience defaults (migration 086 columns on
// tenant_campaign_settings). The 078 trigger seeds a row per tenant and the
// column defaults fill these two, so a missing row is an anomaly: it reads as
// the column defaults and the first save creates the row.
import { createServerSupabaseClient } from '../client'
import {
  DEFAULT_AUDIENCE_DEFAULTS,
  parseSkipContactQuality,
  type CampaignAudienceDefaults,
} from '@/domain/value-objects/audience-filters'

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
    .from('tenant_campaign_settings')
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
  const { data, error } = await createServerSupabaseClient()
    .from('tenant_campaign_settings')
    .upsert(
      {
        restaurant_id: restaurantId,
        skip_contact_quality: defaults.skipContactQuality,
        lapsed_after_days: defaults.lapsedAfterDays,
      },
      { onConflict: 'restaurant_id' }
    )
    .select(COLUMNS)
    .single()
  if (error || !data) throw new Error(`saveAudienceDefaults: ${error?.message}`)
  return mapRow(data as Row)
}
