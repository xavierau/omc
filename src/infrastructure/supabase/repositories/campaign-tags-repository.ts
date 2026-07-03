import { createServerSupabaseClient } from '../client'

/**
 * SOLE writer to `campaign_tags`. The service-role client bypasses RLS — the
 * table has no INSERT/UPDATE/DELETE policies by design (migration 055). Tenant
 * ownership of every tag is therefore re-asserted in app code before writing.
 * Mirrors `campaign-members-repository.ts`.
 */

export class CrossTenantTagError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'CrossTenantTagError'
  }
}

export async function setCampaignTags(
  campaignId: string,
  tagIds: string[],
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  if (tagIds.length > 0) {
    await assertTagsBelongToTenant(tagIds, restaurantId)
  }
  // Replace semantics: clear existing links, then insert the new set.
  await supabase.from('campaign_tags').delete().eq('campaign_id', campaignId)
  if (tagIds.length > 0) {
    const rows = tagIds.map((tid) => ({
      campaign_id: campaignId,
      tag_id: tid,
      restaurant_id: restaurantId,
    }))
    const { error } = await supabase.from('campaign_tags').insert(rows)
    if (error) throw new Error(`setCampaignTags: ${error.message}`)
  }
}

async function assertTagsBelongToTenant(
  tagIds: string[],
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('tags')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .in('id', tagIds)

  if (error) throw new Error(`setCampaignTags: ${error.message}`)
  const validIds = new Set((data ?? []).map((r) => r.id as string))
  if (validIds.size !== new Set(tagIds).size) {
    throw new CrossTenantTagError('Invalid tag IDs')
  }
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
