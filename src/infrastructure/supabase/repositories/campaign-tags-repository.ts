import { createServerSupabaseClient } from '../client'
import {
  assertTagsBelongToTenant,
  CrossTenantTagError,
} from './member-tag-repository'

/**
 * SOLE writer to `campaign_tags`. The service-role client bypasses RLS — the
 * table has no INSERT/UPDATE/DELETE policies by design (migration 066). Tenant
 * ownership of every tag is therefore re-asserted in app code before writing.
 * Mirrors `campaign-members-repository.ts`.
 *
 * Both the assertion and its error class come from `member-tag-repository`:
 * two same-named classes with different status codes used to exist, so which
 * HTTP code a foreign tag id produced depended on which route caught it
 * (review round 2, finding 5).
 */
export { CrossTenantTagError }

export async function setCampaignTags(
  campaignId: string,
  tagIds: string[],
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const uniqueTagIds = [...new Set(tagIds)]
  await assertTagsBelongToTenant(uniqueTagIds, restaurantId)

  // Replace semantics: clear existing links, then write the new set. The
  // delete is tenant-scoped and its error checked — a silent failure here
  // would leave the OLD audience linked to a campaign that reports the new one.
  const { error: deleteError } = await supabase
    .from('campaign_tags')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('restaurant_id', restaurantId)
  if (deleteError) {
    throw new Error(`setCampaignTags(delete): ${deleteError.message}`)
  }
  if (uniqueTagIds.length === 0) return

  const rows = uniqueTagIds.map((tid) => ({
    campaign_id: campaignId,
    tag_id: tid,
    restaurant_id: restaurantId,
  }))
  // Upsert rather than insert: a concurrent write that re-created a link
  // between the delete and this statement must not 409 the whole request.
  const { error } = await supabase.from('campaign_tags').upsert(rows, {
    onConflict: 'campaign_id,tag_id',
    ignoreDuplicates: true,
  })
  if (error) throw new Error(`setCampaignTags: ${error.message}`)
}

export async function getCampaignTagIds(
  campaignId: string
): Promise<string[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaign_tags')
    .select('tag_id')
    .eq('campaign_id', campaignId)
  if (error) throw new Error(`getCampaignTagIds: ${error.message}`)
  return (data ?? []).map((r) => r.tag_id as string)
}
