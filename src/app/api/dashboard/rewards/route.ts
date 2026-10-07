import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { createReward, updateReward } from '@/infrastructure/supabase/repositories/reward-repository'
import { Reward } from '@/domain/entities/reward'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

const DISCOUNT_TYPES = ['percentage', 'fixed_amount'] as const

function handleError(error: unknown, context: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error(`${context}:`, error)
  return NextResponse.json({ error: context }, { status: 500 })
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

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('rewards').select('*').eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true })
    if (error) throw error
    return NextResponse.json({ rewards: (data ?? []).map(mapRowToReward) })
  } catch (error) {
    return handleError(error, 'Failed to load rewards')
  }
}

function validateRewardBody(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== 'string') return 'name is required'
  if (typeof body.pointsCost !== 'number' || body.pointsCost <= 0) return 'pointsCost must be a positive number'
  if (!DISCOUNT_TYPES.includes(body.discountType as typeof DISCOUNT_TYPES[number])) {
    return `discountType must be one of: ${DISCOUNT_TYPES.join(', ')}`
  }
  if (typeof body.discountValue !== 'number' || body.discountValue <= 0) return 'discountValue must be a positive number'
  if (body.couponExpiryDays !== undefined && (typeof body.couponExpiryDays !== 'number' || body.couponExpiryDays < 1 || !Number.isInteger(body.couponExpiryDays))) {
    return 'couponExpiryDays must be a positive integer'
  }
  if (body.sortOrder !== undefined && (typeof body.sortOrder !== 'number' || !Number.isInteger(body.sortOrder))) {
    return 'sortOrder must be an integer'
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = await request.json()
    const err = validateRewardBody(body)
    if (err) return NextResponse.json({ error: err }, { status: 400 })

    const reward = await createReward({
      restaurantId, name: body.name, pointsCost: body.pointsCost,
      discountType: body.discountType, discountValue: body.discountValue,
      couponExpiryDays: body.couponExpiryDays, sortOrder: body.sortOrder,
    })
    return NextResponse.json(reward, { status: 201 })
  } catch (error) {
    return handleError(error, 'Failed to create reward')
  }
}

export async function PUT(request: NextRequest) {
  try {
    await getTenantContext()
    const body = await request.json()
    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const changes: Partial<Omit<Reward, 'id'>> = {}
    const fields = ['name', 'pointsCost', 'discountType', 'discountValue', 'couponExpiryDays', 'sortOrder', 'isActive'] as const
    for (const f of fields) {
      if (body[f] !== undefined) (changes as Record<string, unknown>)[f] = body[f]
    }

    const reward = await updateReward(body.id, changes)
    return NextResponse.json(reward)
  } catch (error) {
    return handleError(error, 'Failed to update reward')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await getTenantContext()
    const body = await request.json()
    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    await updateReward(body.id, { isActive: false })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to delete reward')
  }
}
