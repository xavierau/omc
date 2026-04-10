import { NextRequest, NextResponse } from 'next/server'
import { merchantRedeemCoupon } from '@/application/merchant-redeem-coupon'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = await request.json()
    const rawCode = typeof body.code === 'string' ? body.code : ''
    const cleanCode = rawCode.replace(/^REDEEM\s+/i, '').trim()

    if (!cleanCode) {
      return NextResponse.json(
        { success: false, error: 'invalid_input', message: 'Coupon code is required.' },
        { status: 400 }
      )
    }

    const result = await merchantRedeemCoupon(cleanCode, restaurantId)

    if (!result.success) {
      return NextResponse.json(result, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      console.error('[scan/redeem] AuthError:', error.message, 'status:', error.statusCode)
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[scan/redeem] Unhandled error:', {
      name: (error as Error)?.name,
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    })
    return NextResponse.json(
      { success: false, error: 'server_error', message: 'Failed to redeem coupon.' },
      { status: 500 }
    )
  }
}
