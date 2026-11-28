'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { performMemberDelete } from './member-delete-helpers'

interface MemberDeleteSectionProps {
  memberId: string
  memberName: string | null
  memberPhone: string
  onDeleted: () => void
}

export function MemberDeleteSection({
  memberId,
  memberName,
  memberPhone,
  onDeleted,
}: MemberDeleteSectionProps) {
  const t = useTranslations('members')
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const displayName = memberName ?? t('detailTitle')

  const handleConfirm = async () => {
    // Double-click guard: React batches state updates, so a second click
    // fired in the same tick would otherwise queue another DELETE before
    // `deleting` flips. Reading the latest state synchronously via the
    // closure variable is enough here because the handler is always
    // entered from the same render.
    if (deleting) return
    setDeleting(true)
    setError(null)
    try {
      await performMemberDelete(memberId)
      setConfirming(false)
      onDeleted()
    } catch {
      setError(t('deleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  if (!confirming) {
    return (
      <div className="pt-2">
        <Button
          variant="destructive"
          onClick={() => setConfirming(true)}
        >
          {t('deleteMember')}
        </Button>
      </div>
    )
  }

  return (
    <div className="pt-2 space-y-3 border border-destructive/30 rounded-md p-3 bg-destructive/5">
      <h4 className="text-sm font-semibold text-destructive">
        {t('deleteConfirmTitle')}
      </h4>
      <p className="text-sm text-muted-foreground">
        {t('deleteConfirmBody', { name: displayName, phone: memberPhone })}
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          onClick={handleConfirm}
          disabled={deleting}
        >
          {deleting ? t('deleting') : t('deleteConfirmButton')}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setConfirming(false)
            setError(null)
          }}
          disabled={deleting}
        >
          {t('deleteCancelButton')}
        </Button>
      </div>
    </div>
  )
}
