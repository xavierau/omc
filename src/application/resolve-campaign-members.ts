import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { Campaign } from '@/domain/entities/campaign'
import { Member } from '@/domain/entities/member'
import { getCampaignTagIds } from '@/infrastructure/supabase/repositories/campaign-tags-repository'

const MEMBER_COLUMNS =
  'id, restaurant_id, phone, name, points_balance, status, joined_at, last_visit_at, preferred_language, pmm_throttled_until, unreachable_at'

export async function resolveTargetMembers(
  campaign: Campaign,
  restaurantId: string
): Promise<Member[]> {
  if (campaign.targetAudience === 'selected') {
    return fetchSelectedMembers(campaign.id, restaurantId)
  }
  if (campaign.targetAudience === 'tag') {
    return fetchTagMembers(campaign, restaurantId)
  }
  if (campaign.type === 'winback') {
    return fetchWinbackMembers(campaign, restaurantId)
  }
  if (campaign.type === 'promo') {
    return fetchActiveMembers(restaurantId)
  }
  if (campaign.type === 'birthday') {
    console.warn('Birthday campaigns not yet supported')
    return []
  }
  return []
}

async function fetchWinbackMembers(
  campaign: Campaign,
  restaurantId: string
): Promise<Member[]> {
  const inactiveDays = (campaign.schedule as { inactiveDays?: number })
    ?.inactiveDays ?? 30
  const cutoff = new Date(
    Date.now() - inactiveDays * 24 * 60 * 60 * 1000
  ).toISOString()

  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .select(MEMBER_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active')
    .lt('last_visit_at', cutoff)

  if (error) throw new Error(`fetchWinbackMembers: ${error.message}`)
  return (data ?? []).map(mapRowToMember)
}

async function fetchActiveMembers(
  restaurantId: string
): Promise<Member[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .select(MEMBER_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active')

  if (error) throw new Error(`fetchActiveMembers: ${error.message}`)
  return (data ?? []).map(mapRowToMember)
}

async function fetchSelectedMembers(
  campaignId: string,
  restaurantId: string
): Promise<Member[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaign_members')
    .select('member_id')
    .eq('campaign_id', campaignId)
  if (error) throw new Error(`fetchSelectedMembers: ${error.message}`)
  const memberIds = (data ?? []).map((r) => r.member_id as string)
  if (memberIds.length === 0) return []
  const { data: members, error: mErr } = await supabase
    .from('members')
    .select(MEMBER_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .in('id', memberIds)
  if (mErr) throw new Error(`fetchSelectedMembers: ${mErr.message}`)
  return (members ?? []).map(mapRowToMember)
}

// Target-by-tag resolves to whoever carries the linked tag(s) at SEND time
// (dynamic membership). Mirrors the two-step fetchSelectedMembers shape and
// stays tenant-scoped via restaurant_id on member_tags.
async function fetchTagMembers(
  campaign: Campaign,
  restaurantId: string
): Promise<Member[]> {
  const tagIds = await getCampaignTagIds(campaign.id)
  if (tagIds.length === 0) return []
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('member_tags')
    .select('member_id')
    .eq('restaurant_id', restaurantId)
    .in('tag_id', tagIds)
  if (error) throw new Error(`fetchTagMembers: ${error.message}`)
  const memberIds = [...new Set((data ?? []).map((r) => r.member_id as string))]
  if (memberIds.length === 0) return []
  return fetchMembersByIds(memberIds, restaurantId)
}

async function fetchMembersByIds(
  memberIds: string[],
  restaurantId: string
): Promise<Member[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .select(MEMBER_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .in('id', memberIds)
  if (error) throw new Error(`fetchMembersByIds: ${error.message}`)
  return (data ?? []).map(mapRowToMember)
}

function mapRowToMember(row: Record<string, unknown>): Member {
  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as string,
    phone: row.phone as string,
    name: (row.name as string) ?? null,
    pointsBalance: Number(row.points_balance ?? 0),
    status: row.status as Member['status'],
    joinedAt: row.joined_at as string,
    lastVisitAt: (row.last_visit_at as string) ?? null,
    preferredLanguage: (row.preferred_language as string) ?? null,
    pmmThrottledUntil: (row.pmm_throttled_until as string) ?? null,
    unreachableAt: (row.unreachable_at as string) ?? null,
  }
}
