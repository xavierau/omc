import { createServerSupabaseClient } from '../client'

export class CrossTenantMemberError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'CrossTenantMemberError'
  }
}

export async function setCampaignMembers(
  campaignId: string,
  memberIds: string[],
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  if (memberIds.length > 0) {
    await assertMembersBelongToTenant(memberIds, restaurantId)
  }
  // Delete existing members for this campaign
  await supabase.from('campaign_members').delete().eq('campaign_id', campaignId)
  if (memberIds.length > 0) {
    const rows = memberIds.map((mid) => ({
      campaign_id: campaignId,
      member_id: mid,
    }))
    const { error } = await supabase.from('campaign_members').insert(rows)
    if (error) throw new Error(`setCampaignMembers: ${error.message}`)
  }
}

async function assertMembersBelongToTenant(
  memberIds: string[],
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .in('id', memberIds)

  if (error) throw new Error(`setCampaignMembers: ${error.message}`)
  const validIds = new Set((data ?? []).map((r) => r.id as string))
  if (validIds.size !== new Set(memberIds).size) {
    throw new CrossTenantMemberError('Invalid member IDs')
  }
}

export async function getCampaignMemberIds(
  campaignId: string
): Promise<string[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaign_members')
    .select('member_id')
    .eq('campaign_id', campaignId)
  if (error) throw new Error(`getCampaignMemberIds: ${error.message}`)
  return (data ?? []).map((r) => r.member_id as string)
}
