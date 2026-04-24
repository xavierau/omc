'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { MemberDeleteSection } from './member-delete-section'
import {
  CouponList,
  MemberInfo,
  ReceiptList,
  type MemberDetail,
} from './member-detail-panel-parts'

interface MemberDetailPanelProps {
  memberId: string | null
  open: boolean
  onClose: () => void
  onDeleted?: () => void
}

function MemberBody({
  member,
  onClose,
  onDeleted,
}: {
  member: MemberDetail
  onClose: () => void
  onDeleted?: () => void
}) {
  return (
    <div className="space-y-6 mt-4">
      <MemberInfo member={member} />
      <Separator />
      <ReceiptList receipts={member.receipts} />
      <Separator />
      <CouponList coupons={member.coupons} />
      <Separator />
      <MemberDeleteSection
        memberId={member.id}
        memberName={member.name}
        memberPhone={member.phone}
        onDeleted={() => {
          onClose()
          onDeleted?.()
        }}
      />
    </div>
  )
}

export function MemberDetailPanel({ memberId, open, onClose, onDeleted }: MemberDetailPanelProps) {
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
            <MemberBody member={member} onClose={onClose} onDeleted={onDeleted} />
          ) : (
            <div className="py-8 text-center text-muted-foreground">{t('memberNotFound')}</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
