'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface MemberDetail {
  id: string
  name: string | null
  phone: string
  points_balance: number
  status: string
  joined_at: string
  last_visit_at: string | null
  receipts: { id: string; total_amount: number; points_awarded: number; created_at: string; status: string }[]
  coupons: { id: string; code: string; type: string; status: string; redeemed_at: string | null; discount_type: string | null; discount_value: number | null }[]
  visitCount: number
}

interface MemberDetailPanelProps {
  memberId: string | null
  open: boolean
  onClose: () => void
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('en-HK', { month: 'short', day: 'numeric', year: 'numeric' })
}

function MemberInfo({ member }: { member: MemberDetail }) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <p className="text-muted-foreground">Phone</p>
        <p className="font-medium">{'\u2022\u2022\u2022\u2022' + member.phone.slice(-4)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Points</p>
        <p className="font-medium">{member.points_balance}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Status</p>
        <Badge variant={member.status === 'active' ? 'default' : 'secondary'}>{member.status}</Badge>
      </div>
      <div>
        <p className="text-muted-foreground">Joined</p>
        <p className="font-medium">{formatDate(member.joined_at)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Last Visit</p>
        <p className="font-medium">{formatDate(member.last_visit_at)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Total Visits</p>
        <p className="font-medium">{member.visitCount}</p>
      </div>
    </div>
  )
}

function ReceiptList({ receipts }: { receipts: MemberDetail['receipts'] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">Recent Receipts</h3>
      {receipts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No receipts yet</p>
      ) : (
        <div className="space-y-2">
          {receipts.slice(0, 10).map((r) => (
            <div key={r.id} className="flex justify-between text-sm">
              <span>HK${r.total_amount} &rarr; {r.points_awarded} pts</span>
              <span className="text-muted-foreground">{formatDate(r.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatCouponDiscount(type: string | null, value: number | null): string | null {
  if (!type || value == null) return null
  return type === 'percentage' ? `${value}% off` : `HK$${value} off`
}

function CouponList({ coupons }: { coupons: MemberDetail['coupons'] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">Coupons</h3>
      {coupons.length === 0 ? (
        <p className="text-sm text-muted-foreground">No coupons</p>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => {
            const discount = formatCouponDiscount(c.discount_type, c.discount_value)
            return (
              <div key={c.id} className="flex justify-between items-center text-sm">
                <div>
                  <span className="font-mono">{c.code}</span>
                  {discount && <span className="text-muted-foreground ml-2">{discount}</span>}
                  <span className="text-muted-foreground ml-2">({c.type})</span>
                </div>
                <Badge variant={c.status === 'redeemed' ? 'secondary' : 'default'}>{c.status}</Badge>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function MemberDetailPanel({ memberId, open, onClose }: MemberDetailPanelProps) {
  const [member, setMember] = useState<MemberDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!memberId || !open) return
    setLoading(true)
    fetch(`/api/dashboard/members?id=${memberId}`)
      .then((r) => r.json())
      .then((data) => setMember(data))
      .catch(() => setMember(null))
      .finally(() => setLoading(false))
  }, [memberId, open])

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{member?.name || 'Member Details'}</SheetTitle>
        </SheetHeader>
        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Loading...</div>
        ) : member ? (
          <div className="space-y-6 mt-4">
            <MemberInfo member={member} />
            <Separator />
            <ReceiptList receipts={member.receipts} />
            <Separator />
            <CouponList coupons={member.coupons} />
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">Member not found</div>
        )}
      </SheetContent>
    </Sheet>
  )
}
