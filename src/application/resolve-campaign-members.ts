import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { Campaign } from '@/domain/entities/campaign'
import { Member } from '@/domain/entities/member'

export async function resolveTargetMembers(
  campaign: Campaign,
  restaurantId: string
): Promise<Member[]> {
  if (campaign.targetAudience === 'selected') {
    return fetchSelectedMembers(campaign.id, restaurantId)
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
    .select('id, restaurant_id, phone, name, points_balance, status, joined_at, last_visit_at')
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
    .select('id, restaurant_id, phone, name, points_balance, status, joined_at, last_visit_at')
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
    .select('id, restaurant_id, phone, name, points_balance, status, joined_at, last_visit_at')
    .eq('restaurant_id', restaurantId)
    .in('id', memberIds)
  if (mErr) throw new Error(`fetchSelectedMembers: ${mErr.message}`)
  return (members ?? []).map(mapRowToMember)
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
  }
}
