import { NextRequest, NextResponse } from 'next/server'
import { findCouponById, updateCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const existing = await findCouponById(id)

    if (!existing) {
      return NextResponse.json({ error: 'Coupon not found' }, { status: 404 })
    }

    const updated = await updateCoupon(id, { isActive: !existing.isActive })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('Coupon toggle API error:', error)
    return NextResponse.json({ error: 'Failed to toggle coupon' }, { status: 500 })
  }
}
