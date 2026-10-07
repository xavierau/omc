'use client'

import type { CouponPublicDTO } from '@/application/get-coupon-by-code'
import { CouponCard } from '@/components/coupon/coupon-card'
import { CouponQrDisplay } from '@/components/coupon/coupon-qr-display'

export function SuccessCoupon({ coupon }: { coupon: CouponPublicDTO }) {
  return (
    <CouponCard {...coupon}>
      <CouponQrDisplay code={coupon.code} />
    </CouponCard>
  )
}
