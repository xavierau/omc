'use client'

import { useEffect, useState } from 'react'
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
  const [coupon, setCoupon] = useState<CouponDetail | null>(null)
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!couponId || !open) return
    setLoading(true)
    Promise.all([
      fetch(`/api/dashboard/coupons/${couponId}`).then((r) => r.json()),
      fetch(`/api/dashboard/coupons/${couponId}/redemptions`).then((r) => r.json()),
    ])
      .then(([couponData, redemptionData]) => {
        setCoupon(couponData.coupon ?? couponData)
        setRedemptions(redemptionData.redemptions ?? [])
      })
      .catch(() => { setCoupon(null); setRedemptions([]) })
      .finally(() => setLoading(false))
  }, [couponId, open])

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{coupon?.code ?? 'Coupon Details'}</SheetTitle>
        </SheetHeader>
        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Loading...</div>
        ) : coupon ? (
          <div className="space-y-6 mt-4">
            <CouponInfo coupon={coupon} />
            <Separator />
            <RedemptionList redemptions={redemptions} />
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">Coupon not found</div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function CouponInfo({ coupon }: { coupon: CouponDetail }) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <p className="text-muted-foreground">Code</p>
        <p className="font-mono font-medium">{coupon.code}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Type</p>
        <Badge variant="secondary">{coupon.type}</Badge>
      </div>
      <div>
        <p className="text-muted-foreground">Discount</p>
        <p className="font-medium">{formatDiscount(coupon.discountType, coupon.discountValue)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Uses</p>
        <p className="font-medium">{coupon.currentUses}/{coupon.maxUses ?? '\u221E'}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Status</p>
        <Badge variant={coupon.isActive ? 'default' : 'secondary'}>{coupon.isActive ? 'Active' : 'Inactive'}</Badge>
      </div>
      <div>
        <p className="text-muted-foreground">Expires</p>
        <p className="font-medium">{formatDate(coupon.expiresAt)}</p>
      </div>
      <div className="col-span-2">
        <p className="text-muted-foreground">Description</p>
        <p className="font-medium">{coupon.description || '\u2014'}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Created</p>
        <p className="font-medium">{formatDate(coupon.createdAt)}</p>
      </div>
    </div>
  )
}

function RedemptionList({ redemptions }: { redemptions: Redemption[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">Redemptions</h3>
      {redemptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No redemptions yet</p>
      ) : (
        <div className="space-y-2">
          {redemptions.slice(0, 20).map((r) => (
            <div key={r.id} className="flex justify-between text-sm">
              <span>{r.memberName || 'Unknown member'}</span>
              <span className="text-muted-foreground">{formatDate(r.redeemedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
