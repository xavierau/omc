import { createServerSupabaseClient } from '../client'
import { Reward } from '@/domain/entities/reward'

export interface CreateRewardParams {
  restaurantId: string
  name: string
  pointsCost: number
  discountType: 'percentage' | 'fixed_amount'
  discountValue: number
  couponExpiryDays?: number
  sortOrder?: number
}

function mapRowToReward(row: Record<string, unknown>): Reward {
  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as string,
    name: row.name as string,
    pointsCost: Number(row.points_cost),
    discountType: row.discount_type as Reward['discountType'],
    discountValue: Number(row.discount_value),
    couponExpiryDays: Number(row.coupon_expiry_days),
    isActive: row.is_active as boolean,
    sortOrder: Number(row.sort_order),
  }
}

export async function listActiveRewards(
  restaurantId: string
): Promise<Reward[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('rewards')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(`listActiveRewards: ${error.message}`)
  return (data ?? []).map(mapRowToReward)
}

export async function getRewardById(
  id: string
): Promise<Reward | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('rewards').select('*').eq('id', id).single()

  if (error || !data) return null
  return mapRowToReward(data)
}

export async function createReward(
  params: CreateRewardParams
): Promise<Reward> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('rewards')
    .insert({
      restaurant_id: params.restaurantId,
      name: params.name,
      points_cost: params.pointsCost,
      discount_type: params.discountType,
      discount_value: params.discountValue,
      coupon_expiry_days: params.couponExpiryDays ?? 30,
      sort_order: params.sortOrder ?? 0,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(`createReward: ${error?.message}`)
  return mapRowToReward(data)
}

export async function updateReward(
  id: string,
  changes: Partial<Omit<Reward, 'id'>>
): Promise<Reward> {
  const supabase = createServerSupabaseClient()
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (changes.restaurantId !== undefined) update.restaurant_id = changes.restaurantId
  if (changes.name !== undefined) update.name = changes.name
  if (changes.pointsCost !== undefined) update.points_cost = changes.pointsCost
  if (changes.discountType !== undefined) update.discount_type = changes.discountType
  if (changes.discountValue !== undefined) update.discount_value = changes.discountValue
  if (changes.couponExpiryDays !== undefined) update.coupon_expiry_days = changes.couponExpiryDays
  if (changes.isActive !== undefined) update.is_active = changes.isActive
  if (changes.sortOrder !== undefined) update.sort_order = changes.sortOrder

  const { data, error } = await supabase
    .from('rewards').update(update).eq('id', id).select('*').single()

  if (error || !data) throw new Error(`updateReward: ${error?.message}`)
  return mapRowToReward(data)
}
