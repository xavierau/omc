import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { findById } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { listByRestaurantId } from '@/infrastructure/supabase/repositories/user-tenant-repository'

export interface TenantUser {
  id: string
  email: string
  role: string
  createdAt: string
}

export interface TenantMetrics {
  memberCount: number
  receiptCount: number
  couponRedemptions: number
}

export interface TenantDetail {
  tenant: {
    id: string
    slug: string
    name: string
    whatsappNumber: string | null
    kapsoPhoneNumberId: string | null
    metaBusinessAccountId: string | null
    status: string
    plan: string
    trialExpiresAt: string | null
    createdAt: string
    referrerId: string | null
  }
  users: TenantUser[]
  metrics: TenantMetrics
}

async function fetchTenantMetrics(
  restaurantId: string
): Promise<TenantMetrics> {
  const supabase = createServerSupabaseClient()

  const [members, receipts, redemptions] = await Promise.all([
    supabase.from('members').select('*', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
    supabase.from('receipts').select('*', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
    supabase.from('coupon_redemptions').select('*', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
  ])

  return {
    memberCount: members.count ?? 0,
    receiptCount: receipts.count ?? 0,
    couponRedemptions: redemptions.count ?? 0,
  }
}

async function resolveUserEmails(
  userTenants: { user_id: string; role: string; created_at: string }[]
): Promise<TenantUser[]> {
  const supabase = createServerSupabaseClient()
  const results: TenantUser[] = []

  for (const ut of userTenants) {
    const { data } = await supabase.auth.admin.getUserById(ut.user_id)
    results.push({
      id: ut.user_id,
      email: data?.user?.email ?? '',
      role: ut.role,
      createdAt: ut.created_at,
    })
  }
  return results
}

export async function getTenantDetail(
  id: string
): Promise<TenantDetail | null> {
  const tenant = await findById(id)
  if (!tenant) return null

  const userTenants = await listByRestaurantId(id)
  const [users, metrics] = await Promise.all([
    resolveUserEmails(userTenants),
    fetchTenantMetrics(id),
  ])

  const mappedTenant = {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    whatsappNumber: (tenant as unknown as Record<string, unknown>).whatsapp_number as string | null ?? null,
    kapsoPhoneNumberId: tenant.kapso_phone_number_id,
    metaBusinessAccountId: tenant.meta_business_account_id,
    status: tenant.status,
    plan: tenant.plan ?? 'starter',
    trialExpiresAt: tenant.trial_expires_at,
    createdAt: (tenant as unknown as Record<string, unknown>).created_at as string,
    referrerId: (tenant as unknown as Record<string, unknown>).referrer_id as string | null ?? null,
  }

  return { tenant: mappedTenant, users, metrics }
}
