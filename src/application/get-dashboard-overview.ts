import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

export interface RecentEvent {
  id: string
  type: string
  memberName: string | null
  dataJson: Record<string, unknown>
  createdAt: string
}

export interface DashboardOverview {
  totalMembers: number
  newMembersToday: number
  totalPointsIssued: number
  activeCampaigns: number
  redemptionRate: number
  recentEvents: RecentEvent[]
}

async function fetchMemberCounts(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string
): Promise<{ total: number; today: number }> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  const { count: total } = await supabase
    .from('members')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)

  const { count: today } = await supabase
    .from('members')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .gte('joined_at', todayStart.toISOString())

  return { total: total ?? 0, today: today ?? 0 }
}

async function fetchTotalPointsIssued(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string
): Promise<number> {
  const { data } = await supabase
    .from('receipts')
    .select('points_awarded')
    .eq('restaurant_id', restaurantId)

  if (!data || data.length === 0) return 0
  return data.reduce((sum, r) => sum + (r.points_awarded ?? 0), 0)
}

async function fetchActiveCampaigns(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string
): Promise<number> {
  const { count } = await supabase
    .from('campaigns')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active')

  return count ?? 0
}

async function fetchRedemptionRate(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string
): Promise<number> {
  const { count: totalCoupons } = await supabase
    .from('coupons')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)

  if (!totalCoupons || totalCoupons === 0) return 0

  const { count: redemptionCount } = await supabase
    .from('coupon_redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)

  return Math.round(((redemptionCount ?? 0) / totalCoupons) * 100)
}

function extractMemberName(members: unknown): string | null {
  if (Array.isArray(members) && members.length > 0) {
    return (members[0] as { name: string }).name ?? null
  }
  if (members && typeof members === 'object' && 'name' in members) {
    return (members as { name: string }).name ?? null
  }
  return null
}

async function fetchRecentEvents(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string
): Promise<RecentEvent[]> {
  const { data } = await supabase
    .from('events')
    .select('id, type, data_json, created_at, members(name)')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (!data) return []

  return data.map((e) => ({
    id: e.id,
    type: e.type,
    memberName: extractMemberName(e.members),
    dataJson: (e.data_json as Record<string, unknown>) ?? {},
    createdAt: e.created_at,
  }))
}

export async function getDashboardOverview(
  restaurantId: string
): Promise<DashboardOverview> {
  const supabase = createServerSupabaseClient()

  const [members, totalPointsIssued, activeCampaigns, redemptionRate, recentEvents] =
    await Promise.all([
      fetchMemberCounts(supabase, restaurantId),
      fetchTotalPointsIssued(supabase, restaurantId),
      fetchActiveCampaigns(supabase, restaurantId),
      fetchRedemptionRate(supabase, restaurantId),
      fetchRecentEvents(supabase, restaurantId),
    ])

  return {
    totalMembers: members.total,
    newMembersToday: members.today,
    totalPointsIssued,
    activeCampaigns,
    redemptionRate,
    recentEvents,
  }
}
