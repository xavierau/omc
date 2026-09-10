'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { QrScanner } from '@/components/dashboard/qr-scanner'
import { StampResultCard } from '@/components/dashboard/stamp-result-card'
import { useGiveStamp } from '@/hooks/use-give-stamp'

interface ScanStampFlowProps {
  onCameraBlocked: () => void
}

// Give-Stamp mode (plan §5). A decode goes to the one-tap confirm screen; the confirm
// POSTs the payload UN-STRIPPED to /api/dashboard/scan/stamp, BYPASSING parseCode (which
// rejects LOYALTY: payloads). The server's unique index makes a double-tap a no-op.
export function ScanStampFlow({ onCameraBlocked }: ScanStampFlowProps) {
  const t = useTranslations('scan')
  const router = useRouter()
  const stamp = useGiveStamp()

  const onScan = useCallback((text: string) => {
    if (!text) { onCameraBlocked(); return }
    stamp.onDecode(text)
  }, [stamp, onCameraBlocked])

  const onAddMember = useCallback(() => {
    router.push('/dashboard/members/import')
  }, [router])

  if (stamp.state === 'idle') {
    return (
      <>
        <QrScanner onScan={onScan} active />
        <p className="text-center text-sm text-muted-foreground">{t('scanning')}</p>
      </>
    )
  }

  return (
    <StampResultCard
      result={stamp.state === 'result' ? stamp.result : null}
      loading={stamp.loading}
      lookupLoading={stamp.loading}
      lookupNotFound={stamp.phoneLookupFailed}
      onConfirm={stamp.confirmGive}
      onGiveAnother={stamp.reset}
      onLookupByPhone={stamp.lookupByPhone}
      onAddMember={onAddMember}
    />
  )
}
