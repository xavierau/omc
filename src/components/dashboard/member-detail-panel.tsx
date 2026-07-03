'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { MemberDeleteSection } from './member-delete-section'
import { MemberStampReversalSection } from './member-stamp-reversal-section'
import { MemberTagsSection } from './member-tags-section'

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
  tags?: { id: string; name: string; color: string }[]
}

interface MemberDetailPanelProps {
  memberId: string | null
  open: boolean
  onClose: () => void
  onDeleted?: () => void
  onTagsChanged?: () => void
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('en-HK', { month: 'short', day: 'numeric', year: 'numeric' })
}

function MemberInfo({ member }: { member: MemberDetail }) {
  const t = useTranslations('members')

  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <p className="text-muted-foreground">{t('phone')}</p>
        <p className="font-medium">{member.phone}</p>
      </div>
      <div>
        <p className="text-muted-foreground">{t('points')}</p>
        <p className="font-medium">{member.points_balance}</p>
      </div>
      <div>
        <p className="text-muted-foreground">{t('status')}</p>
        <Badge variant={member.status === 'active' ? 'default' : 'secondary'}>{member.status}</Badge>
      </div>
      <div>
        <p className="text-muted-foreground">{t('joined')}</p>
        <p className="font-medium">{formatDate(member.joined_at)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">{t('lastVisit')}</p>
        <p className="font-medium">{formatDate(member.last_visit_at)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">{t('totalVisits')}</p>
        <p className="font-medium">{member.visitCount}</p>
      </div>
    </div>
  )
}

function ReceiptList({ receipts }: { receipts: MemberDetail['receipts'] }) {
  const t = useTranslations('members')

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">{t('recentReceipts')}</h3>
      {receipts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noReceipts')}</p>
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

function formatCouponDiscount(type: string | null, value: number | null, t: ReturnType<typeof useTranslations<'members'>>): string | null {
  if (!type || value == null) return null
  return type === 'percentage' ? t('percentOff', { value }) : t('fixedOff', { value })
}

function CouponList({ coupons }: { coupons: MemberDetail['coupons'] }) {
  const t = useTranslations('members')

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">{t('couponsSection')}</h3>
      {coupons.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noCoupons')}</p>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => {
            const discount = formatCouponDiscount(c.discount_type, c.discount_value, t)
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

export function MemberDetailPanel({ memberId, open, onClose, onDeleted, onTagsChanged }: MemberDetailPanelProps) {
  const t = useTranslations('members')
  const tc = useTranslations('common')
  const [member, setMember] = useState<MemberDetail | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchMember = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const data = await fetch(`/api/dashboard/members?id=${id}`).then((r) => r.json())
      setMember(data)
    } catch {
      setMember(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!memberId || !open) return
    fetchMember(memberId)
  }, [memberId, open, fetchMember])

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{member?.name || t('detailTitle')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">{tc('loading')}</div>
          ) : member ? (
            <div className="space-y-6 mt-4">
              <MemberInfo member={member} />
              <Separator />
              <MemberTagsSection memberId={member.id} tags={member.tags ?? []} onChanged={onTagsChanged} />
              <Separator />
              <ReceiptList receipts={member.receipts} />
              <Separator />
              <CouponList coupons={member.coupons} />
              <Separator />
              <MemberStampReversalSection memberId={member.id} />
              <Separator />
              <MemberDeleteSection
                memberId={member.id}
                memberName={member.name}
                memberPhone={member.phone}
                onDeleted={() => {
                  onDeleted?.()
                  onClose()
                }}
              />
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">{t('memberNotFound')}</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
