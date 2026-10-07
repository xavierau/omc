'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface CouponDetail {
  id: string
  code: string
  type: string
  status: string
  discountType: string | null
  discountValue: number | null
  maxUses: number | null
  currentUses: number
  isActive: boolean
  expiresAt: string | null
  description: string | null
  createdAt: string
}

interface Redemption {
  id: string
  memberName: string | null
  memberId: string
  redeemedAt: string
}

interface CouponDetailPanelProps {
  couponId: string | null
  open: boolean
  onClose: () => void
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('en-HK', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDiscount(type: string | null, value: number | null): string {
  if (!type || value == null) return '\u2014'
  return type === 'percentage' ? `${value}%` : `HK$${value}`
}

export function CouponDetailPanel({ couponId, open, onClose }: CouponDetailPanelProps) {
  const t = useTranslations('coupons')
  const tc = useTranslations('common')
  const [coupon, setCoupon] = useState<CouponDetail | null>(null)
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [loading, setLoading] = useState(false)

  const fetchCouponData = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const [couponData, redemptionData] = await Promise.all([
        fetch(`/api/dashboard/coupons/${id}`).then((r) => r.json()),
        fetch(`/api/dashboard/coupons/${id}/redemptions`).then((r) => r.json()),
      ])
      setCoupon(couponData.coupon ?? couponData)
      setRedemptions(redemptionData.redemptions ?? [])
    } catch {
      setCoupon(null)
      setRedemptions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!couponId || !open) return
    fetchCouponData(couponId)
  }, [couponId, open, fetchCouponData])

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{coupon?.code ?? t('couponDetails')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">{tc('loading')}</div>
          ) : coupon ? (
            <div className="space-y-6 mt-4">
              <CouponInfo coupon={coupon} />
              <Separator />
              <RedemptionList redemptions={redemptions} />
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">{t('couponNotFound')}</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function CouponInfo({ coupon }: { coupon: CouponDetail }) {
  const t = useTranslations('coupons')
  const tc = useTranslations('common')

  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <p className="text-muted-foreground">{t('code')}</p>
        <p className="font-mono font-medium">{coupon.code}</p>
      </div>
      <div>
        <p className="text-muted-foreground">{t('type')}</p>
        <Badge variant="secondary">{coupon.type}</Badge>
      </div>
      <div>
        <p className="text-muted-foreground">{t('discount')}</p>
        <p className="font-medium">{formatDiscount(coupon.discountType, coupon.discountValue)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">{t('uses')}</p>
        <p className="font-medium">{coupon.currentUses}/{coupon.maxUses ?? '\u221E'}</p>
      </div>
      <div>
        <p className="text-muted-foreground">{t('type')}</p>
        <Badge variant={coupon.isActive ? 'default' : 'secondary'}>{coupon.isActive ? tc('active') : tc('inactive')}</Badge>
      </div>
      <div>
        <p className="text-muted-foreground">{t('expires')}</p>
        <p className="font-medium">{formatDate(coupon.expiresAt)}</p>
      </div>
      <div className="col-span-2">
        <p className="text-muted-foreground">{t('description')}</p>
        <p className="font-medium">{coupon.description || '\u2014'}</p>
      </div>
      <div>
        <p className="text-muted-foreground">{t('created')}</p>
        <p className="font-medium">{formatDate(coupon.createdAt)}</p>
      </div>
    </div>
  )
}

function RedemptionList({ redemptions }: { redemptions: Redemption[] }) {
  const t = useTranslations('coupons')

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">{t('redemptions')}</h3>
      {redemptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noRedemptions')}</p>
      ) : (
        <div className="space-y-2">
          {redemptions.slice(0, 20).map((r) => (
            <div key={r.id} className="flex justify-between text-sm">
              <span>{r.memberName || t('unknownMember')}</span>
              <span className="text-muted-foreground">{formatDate(r.redeemedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
