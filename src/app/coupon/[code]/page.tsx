import { notFound } from 'next/navigation'
import { getCouponByCode } from '@/application/get-coupon-by-code'
import { CouponCard } from '@/components/coupon/coupon-card'
import { CouponQrDisplay } from '@/components/coupon/coupon-qr-display'

export default async function CouponPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const coupon = await getCouponByCode(code)

  if (!coupon) {
    notFound()
  }

  const isInactive = coupon.isExpired || coupon.isRedeemed

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className={`w-full max-w-md space-y-6 ${isInactive ? 'opacity-60' : ''}`}>
        <CouponCard {...coupon} />
        {!isInactive && <CouponQrDisplay code={coupon.code} />}
      </div>
      {isInactive && (
        <p className="mt-4 text-sm text-muted-foreground">
          {coupon.isRedeemed ? 'This coupon has already been redeemed.' : 'This coupon has expired.'}
        </p>
      )}
    </main>
  )
}
