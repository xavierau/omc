import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getCouponByCode } from '@/application/get-coupon-by-code'
import { SuccessCoupon } from './success-coupon'

export default async function JoinSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const { code } = await searchParams
  if (!code) redirect('/join')

  const coupon = await getCouponByCode(code)
  if (!coupon) redirect('/join')

  const t = await getTranslations('join')

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t('successHeading')}</h1>
          <p className="mt-2 text-muted-foreground">{t('successSubtitle')}</p>
        </div>
        <SuccessCoupon coupon={coupon} />
      </div>
    </main>
  )
}
