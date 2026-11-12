import {
  setCampaignTags as setCampaignTagsRepo,
  CrossTenantTagError,
} from '@/infrastructure/supabase/repositories/campaign-tags-repository'

export { CrossTenantTagError }

/**
 * Replace the set of tags a campaign targets. Tenant ownership of every tag is
 * re-asserted inside the repository (service-role writes bypass RLS), so tag
 * ids taken from the request body are never trusted (lazy-flow authorization
 * parity). Members are expanded from these tags live at send time in
 * `resolve-campaign-members.ts`.
 */
export async function setCampaignTags(
  campaignId: string,
  tagIds: string[],
  restaurantId: string
): Promise<void> {
  await setCampaignTagsRepo(campaignId, tagIds, restaurantId)
}
