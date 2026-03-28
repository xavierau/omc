import { createServerSupabaseClient } from '../client'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { Coupon } from '@/domain/entities/coupon'
import { mapRowToCoupon, CreateCouponParams, ListCouponsParams, ListCouponsResult } from './coupon-mapper'

export type { CreateCouponParams, ListCouponsParams, ListCouponsResult }

const MAX_CODE_ATTEMPTS = 3
const WELCOME_EXPIRY_DAYS = 30

export async function createCoupon(params: CreateCouponParams): Promise<Coupon> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('coupons')
    .insert({
      restaurant_id: params.restaurantId,
      type: params.type,
      code: params.code,
      status: 'active',
      member_id: params.memberId ?? null,
      expires_at: params.expiresAt ?? null,
      discount_type: params.discountType ?? null,
      discount_value: params.discountValue ?? null,
      max_uses: params.maxUses ?? null,
      is_active: true,
      description: params.description ?? null,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(`createCoupon: ${error?.message}`)
  return mapRowToCoupon(data)
}

export async function createWelcomeCoupon(
  restaurantId: string,
  memberId: string
): Promise<{ code: string; id: string }> {
  const expiresAt = new Date(
    Date.now() + WELCOME_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCouponCode()
    try {
      const coupon = await createCoupon({
        restaurantId, type: 'welcome', code, memberId, expiresAt, maxUses: 1,
      })
      return { code: coupon.code, id: coupon.id }
    } catch (err) {
      if (!(err as Error).message.includes('unique')) throw err
    }
  }

  throw new Error('Failed to generate unique coupon code after 3 attempts')
}

export async function findCouponById(id: string): Promise<Coupon | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('coupons').select('*').eq('id', id).single()

  if (error || !data) return null
  return mapRowToCoupon(data)
}

export async function findCouponByCode(code: string): Promise<Coupon | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('coupons').select('*').eq('code', code.toUpperCase()).single()

  if (error || !data) return null
  return mapRowToCoupon(data)
}

export async function listCoupons(params: ListCouponsParams): Promise<ListCouponsResult> {
  const supabase = createServerSupabaseClient()
  const { restaurantId, page, pageSize, type, isActive } = params
  const from = (page - 1) * pageSize

  let query = supabase.from('coupons').select('*', { count: 'exact' })
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (type) query = query.eq('type', type)
  if (isActive !== undefined) query = query.eq('is_active', isActive)

  const { data, error, count } = await query
  if (error) throw new Error(`listCoupons: ${error.message}`)

  return { coupons: (data ?? []).map(mapRowToCoupon), total: count ?? 0 }
}

export async function updateCoupon(
  id: string,
  changes: Partial<Pick<Coupon, 'description' | 'discountType' | 'discountValue' | 'maxUses' | 'expiresAt' | 'isActive'>>
): Promise<Coupon> {
  const supabase = createServerSupabaseClient()
  const update: Record<string, unknown> = {}

  if (changes.description !== undefined) update.description = changes.description
  if (changes.discountType !== undefined) update.discount_type = changes.discountType
  if (changes.discountValue !== undefined) update.discount_value = changes.discountValue
  if (changes.maxUses !== undefined) update.max_uses = changes.maxUses
  if (changes.expiresAt !== undefined) update.expires_at = changes.expiresAt
  if (changes.isActive !== undefined) update.is_active = changes.isActive

  const { data, error } = await supabase
    .from('coupons').update(update).eq('id', id).select('*').single()

  if (error || !data) throw new Error(`updateCoupon: ${error?.message}`)
  return mapRowToCoupon(data)
}

export async function incrementCouponUses(couponId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.rpc('increment_coupon_uses', {
    coupon_id_param: couponId,
  })

  if (error) throw new Error(`incrementCouponUses: ${error.message}`)
}

export async function decrementCouponUses(couponId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.rpc('decrement_coupon_uses', {
    coupon_id_param: couponId,
  })

  if (error) throw new Error(`decrementCouponUses: ${error.message}`)
}

export async function redeemCoupon(couponId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('coupons')
    .update({ status: 'redeemed', redeemed_at: new Date().toISOString() })
    .eq('id', couponId)

  if (error) throw new Error(`redeemCoupon: ${error.message}`)
}
