import { createServerSupabaseClient } from '../client'

export async function setCampaignMembers(
  campaignId: string,
  memberIds: string[]
): Promise<void> {
  const supabase = createServerSupabaseClient()
  // Delete existing members for this campaign
  await supabase.from('campaign_members').delete().eq('campaign_id', campaignId)
  // Insert new members if any
  if (memberIds.length > 0) {
    const rows = memberIds.map((mid) => ({
      campaign_id: campaignId,
      member_id: mid,
    }))
    const { error } = await supabase.from('campaign_members').insert(rows)
    if (error) throw new Error(`setCampaignMembers: ${error.message}`)
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
