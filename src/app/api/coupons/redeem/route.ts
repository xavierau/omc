import { NextRequest, NextResponse } from 'next/server'
import { redeemCouponUseCase } from '@/application/redeem-coupon'

export async function POST(request: NextRequest) {
  try {
    const { code, memberId } = await request.json()

    if (!code || !memberId || typeof code !== 'string' || typeof memberId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid code/memberId (must be strings)' },
        { status: 400 }
      )
    }

    const result = await redeemCouponUseCase(code, memberId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Redeem error:', error)
    return NextResponse.json(
      { error: 'Failed to redeem' },
      { status: 500 }
    )
  }
}
