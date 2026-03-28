import { NextRequest, NextResponse } from 'next/server'
import { listCouponsUseCase } from '@/application/list-coupons'
import { createCouponUseCase } from '@/application/create-coupon'
import { COUPONS_PAGE_SIZE } from '@/lib/constants'
import { Coupon } from '@/domain/entities/coupon'

const DEMO_RESTAURANT_ID = '00000000-0000-4000-a000-000000000001'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const page = parseInt(searchParams.get('page') ?? '1', 10)
    const type = searchParams.get('type') as Coupon['type'] | null
    const isActiveParam = searchParams.get('isActive')
    const isActive = isActiveParam !== null ? isActiveParam === 'true' : undefined

    const result = await listCouponsUseCase({
      restaurantId: DEMO_RESTAURANT_ID,
      page,
      pageSize: COUPONS_PAGE_SIZE,
      type: type ?? undefined,
      isActive,
    })

    return NextResponse.json({
      coupons: result.coupons,
      total: result.total,
      page,
      pageSize: COUPONS_PAGE_SIZE,
      totalPages: Math.ceil(result.total / COUPONS_PAGE_SIZE),
    })
  } catch (error) {
    console.error('Coupons list API error:', error)
    return NextResponse.json({ error: 'Failed to load coupons' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await createCouponUseCase({
      restaurantId: DEMO_RESTAURANT_ID,
      type: body.type,
      code: body.code,
      memberId: body.memberId ?? null,
      expiresAt: body.expiresAt ?? null,
      discountType: body.discountType ?? null,
      discountValue: body.discountValue ?? null,
      maxUses: body.maxUses ?? null,
      description: body.description ?? null,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    return NextResponse.json(result.coupon, { status: 201 })
  } catch (error) {
    console.error('Coupons create API error:', error)
    return NextResponse.json({ error: 'Failed to create coupon' }, { status: 500 })
  }
}
