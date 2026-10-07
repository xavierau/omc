import { NextResponse } from 'next/server'
import { getCouponByCode } from '@/application/get-coupon-by-code'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const coupon = await getCouponByCode(code)
  if (!coupon) {
    return NextResponse.json(
      { error: 'Coupon not found' },
      { status: 404 }
    )
  }
  return NextResponse.json(coupon)
}
