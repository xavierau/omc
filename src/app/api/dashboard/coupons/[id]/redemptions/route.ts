import { NextRequest, NextResponse } from 'next/server'
import { getRedemptionsForCoupon } from '@/infrastructure/supabase/repositories/coupon-redemption-repository'
import { COUPONS_PAGE_SIZE } from '@/lib/constants'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const { searchParams } = request.nextUrl
    const page = parseInt(searchParams.get('page') ?? '1', 10)

    const result = await getRedemptionsForCoupon({
      couponId: id,
      page,
      pageSize: COUPONS_PAGE_SIZE,
    })

    return NextResponse.json({
      redemptions: result.redemptions,
      total: result.total,
      page,
      pageSize: COUPONS_PAGE_SIZE,
      totalPages: Math.ceil(result.total / COUPONS_PAGE_SIZE),
    })
  } catch (error) {
    console.error('Coupon redemptions API error:', error)
    return NextResponse.json({ error: 'Failed to load redemptions' }, { status: 500 })
  }
}
