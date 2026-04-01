import { NextRequest, NextResponse } from 'next/server'
import { getCouponDetailUseCase } from '@/application/get-coupon-detail'
import { updateCouponUseCase } from '@/application/update-coupon'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await getTenantContext()
    const { id } = await context.params
    const result = await getCouponDetailUseCase(id)

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 404 })
    }

    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Coupon detail API error:', error)
    return NextResponse.json({ error: 'Failed to load coupon' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await getTenantContext()
    const { id } = await context.params
    const body = await request.json()

    const result = await updateCouponUseCase({
      id,
      description: body.description,
      discountType: body.discountType,
      discountValue: body.discountValue,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt,
      isActive: body.isActive,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    return NextResponse.json(result.coupon)
  } catch (error) {
    console.error('Coupon update API error:', error)
    return NextResponse.json({ error: 'Failed to update coupon' }, { status: 500 })
  }
}
