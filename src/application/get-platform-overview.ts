import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { countByStatus, listAll } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'

export interface RecentTenant {
  id: string
  name: string
  slug: string
  status: string
  memberCount: number
  createdAt: string
}

export interface PlatformOverview {
  totalTenants: number
  activeTenants: number
  inactiveTenants: number
  trialTenants: number
  totalMembers: number
  newMembers30d: number
  receiptsProcessed30d: number
  couponsRedeemed30d: number
  messagesSent30d: number
  recentTenants: RecentTenant[]
}

function thirtyDaysAgo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString()
}

async function countMembers(
  supabase: ReturnType<typeof createServerSupabaseClient>
): Promise<{ total: number; recent: number }> {
  const cutoff = thirtyDaysAgo()

  const { count: total } = await supabase
    .from('members')
    .select('*', { count: 'exact', head: true })

  const { count: recent } = await supabase
    .from('members')
    .select('*', { count: 'exact', head: true })
    .gte('joined_at', cutoff)

  return { total: total ?? 0, recent: recent ?? 0 }
}

async function countRecentReceipts(
  supabase: ReturnType<typeof createServerSupabaseClient>
): Promise<number> {
  const { count } = await supabase
    .from('receipts')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', thirtyDaysAgo())

  return count ?? 0
}

async function countRecentRedemptions(
  supabase: ReturnType<typeof createServerSupabaseClient>
): Promise<number> {
  const { count } = await supabase
    .from('coupon_redemptions')
    .select('*', { count: 'exact', head: true })
    .gte('redeemed_at', thirtyDaysAgo())

  return count ?? 0
}

async function countRecentEvents(
  supabase: ReturnType<typeof createServerSupabaseClient>
): Promise<number> {
  const { count } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', thirtyDaysAgo())

  return count ?? 0
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const supabase = createServerSupabaseClient()

  const [tenants, members, receipts, redemptions, events, recent] =
    await Promise.all([
      countByStatus(),
      countMembers(supabase),
      countRecentReceipts(supabase),
      countRecentRedemptions(supabase),
      countRecentEvents(supabase),
      listAll({ page: 1, limit: 10 }),
    ])

  const recentTenants: RecentTenant[] = recent.tenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    memberCount: t.member_count,
    createdAt: t.created_at,
  }))

  return {
    totalTenants: tenants.active + tenants.inactive + tenants.trial,
    activeTenants: tenants.active,
    inactiveTenants: tenants.inactive,
    trialTenants: tenants.trial,
    totalMembers: members.total,
    newMembers30d: members.recent,
    receiptsProcessed30d: receipts,
    couponsRedeemed30d: redemptions,
    messagesSent30d: events,
    recentTenants,
  }
}
