'use client'

import { useTranslations } from 'next-intl'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

interface CouponInfo {
  code: string
  type: string
  discountType: string | null
  discountValue: number | null
  expiresAt: string | null
  currentUses: number
  maxUses: number | null
  description: string | null
  status: string
  isActive: boolean
}

interface ScanResultCardProps {
  coupon: CouponInfo | null
  loading: boolean
  result: { success: boolean; message: string } | null
  error: string | null
  onConfirm: () => void
  onScanAnother: () => void
}

function DiscountDisplay({ coupon, t }: { coupon: CouponInfo; t: ReturnType<typeof useTranslations> }) {
  if (coupon.discountType === 'percentage' && coupon.discountValue) {
    return <span>{t('percentOff', { value: coupon.discountValue })}</span>
  }
  if (coupon.discountType === 'fixed' && coupon.discountValue) {
    return <span>{t('fixedOff', { value: coupon.discountValue })}</span>
  }
  return <span>{t('noDiscount')}</span>
}

function CouponPreview({ coupon, loading, onConfirm, t }: {
  coupon: CouponInfo
  loading: boolean
  onConfirm: () => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('couponCode')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-mono font-bold tracking-wider">{coupon.code}</p>
        <div className="flex gap-2">
          <Badge variant="secondary">{coupon.type}</Badge>
          {coupon.isActive && <Badge>Active</Badge>}
        </div>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>{t('discount')}: <DiscountDisplay coupon={coupon} t={t} /></p>
          <p>{t('expires')}: {coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleDateString() : t('noExpiry')}</p>
          <p>{t('uses')}: {coupon.maxUses ? t('usesCount', { current: coupon.currentUses, max: coupon.maxUses }) : t('usesUnlimited', { current: coupon.currentUses })}</p>
          {coupon.description && <p>{coupon.description}</p>}
        </div>
        <Button className="w-full" size="lg" onClick={onConfirm} disabled={loading}>
          {loading ? <><Loader2 className="animate-spin mr-2" />{t('redeeming')}</> : t('confirmRedeem')}
        </Button>
      </CardContent>
    </Card>
  )
}

function ResultCard({ result, onScanAnother, t }: {
  result: { success: boolean; message: string }
  onScanAnother: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const isSuccess = result.success
  return (
    <Card className={isSuccess ? 'border-green-500' : 'border-destructive'}>
      <CardContent className="pt-6 text-center space-y-4">
        {isSuccess
          ? <CheckCircle2 className="mx-auto size-12 text-green-500" />
          : <XCircle className="mx-auto size-12 text-destructive" />}
        <p className="text-lg font-semibold">{isSuccess ? t('redeemSuccess') : t('redeemError')}</p>
        <p className="text-sm text-muted-foreground">{result.message}</p>
        <Button variant="outline" className="w-full" onClick={onScanAnother}>{t('scanAnother')}</Button>
      </CardContent>
    </Card>
  )
}

export function ScanResultCard({ coupon, loading, result, error, onConfirm, onScanAnother }: ScanResultCardProps) {
  const t = useTranslations('scan')

  if (loading && !coupon) {
    return (
      <Card>
        <CardContent className="pt-6 flex justify-center">
          <Loader2 className="animate-spin size-8 text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6 text-center space-y-4">
          <XCircle className="mx-auto size-12 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" className="w-full" onClick={onScanAnother}>{t('scanAnother')}</Button>
        </CardContent>
      </Card>
    )
  }

  if (result) {
    return <ResultCard result={result} onScanAnother={onScanAnother} t={t} />
  }

  if (coupon) {
    return <CouponPreview coupon={coupon} loading={loading} onConfirm={onConfirm} t={t} />
  }

  return null
}
