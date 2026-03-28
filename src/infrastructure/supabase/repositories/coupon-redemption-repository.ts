import { createServerSupabaseClient } from '../client'
import { CouponRedemption } from '@/domain/entities/coupon-redemption'

export interface RedemptionWithMember extends CouponRedemption {
  memberName: string | null
}

export async function createRedemption(
  couponId: string,
  memberId: string,
  restaurantId: string
): Promise<CouponRedemption> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('coupon_redemptions')
    .insert({
      coupon_id: couponId,
      member_id: memberId,
      restaurant_id: restaurantId,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`createRedemption: ${error?.message}`)
  }

  return mapRowToRedemption(data)
}

export async function hasRedeemed(
  couponId: string,
  memberId: string
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('coupon_redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('coupon_id', couponId)
    .eq('member_id', memberId)

  if (error) throw new Error(`hasRedeemed: ${error.message}`)
  return (count ?? 0) > 0
}

export interface ListRedemptionsParams {
  couponId: string
  page: number
  pageSize: number
}

export interface ListRedemptionsResult {
  redemptions: RedemptionWithMember[]
  total: number
}

export async function getRedemptionsForCoupon(
  params: ListRedemptionsParams
): Promise<ListRedemptionsResult> {
  const supabase = createServerSupabaseClient()
  const { couponId, page, pageSize } = params
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from('coupon_redemptions')
    .select('*, members(name)', { count: 'exact' })
    .eq('coupon_id', couponId)
    .order('redeemed_at', { ascending: false })
    .range(from, to)

  if (error) throw new Error(`getRedemptionsForCoupon: ${error.message}`)

  const redemptions = (data ?? []).map((row: Record<string, unknown>) => ({
    ...mapRowToRedemption(row),
    memberName: extractMemberName(row.members),
  }))

  return { redemptions, total: count ?? 0 }
}

export async function getRedemptionCount(couponId: string): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('coupon_redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('coupon_id', couponId)

  if (error) throw new Error(`getRedemptionCount: ${error.message}`)
  return count ?? 0
}

function mapRowToRedemption(row: Record<string, unknown>): CouponRedemption {
  return {
    id: row.id as string,
    couponId: row.coupon_id as string,
    memberId: row.member_id as string,
    restaurantId: row.restaurant_id as string,
    redeemedAt: row.redeemed_at as string,
  }
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
