'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { reverseStamp, type ReverseStampResult } from '@/hooks/reverse-stamp-client'

interface MemberStampReversalSectionProps {
  memberId: string
}

// "Remove a stamp" audited correction (plan §9 / subtask 15). The backend writes the
// stamp_reversal event with the actor and floors the count at 0; this section confirms
// the intent and reflects the new count the API returns.
export function MemberStampReversalSection({ memberId }: MemberStampReversalSectionProps) {
  const t = useTranslations('members')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ReverseStampResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (busy) return
    setBusy(true); setError(null)
    const out = await reverseStamp(memberId)
    setBusy(false)
    if (out.outcome === 'error' || out.outcome === 'no_active_campaign') {
      setError(t('removeStampFailed'))
      return
    }
    setResult(out)
    setConfirming(false)
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">{t('stampsSection')}</h3>
      <StampStatus result={result} t={t} />
      {confirming ? (
        <ConfirmBox busy={busy} error={error} onConfirm={handleConfirm} onCancel={() => setConfirming(false)} t={t} />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>{t('removeStamp')}</Button>
      )}
    </div>
  )
}

function StampStatus({ result, t }: { result: ReverseStampResult | null; t: ReturnType<typeof useTranslations> }) {
  if (!result) return null
  if (result.outcome === 'at_zero') {
    return <p className="text-sm text-muted-foreground mb-3">{t('removeStampAtZero')}</p>
  }
  return (
    <p className="text-sm mb-3">{t('stampsCount', { count: result.stampsCount, required: result.stampsRequired })}</p>
  )
}

function ConfirmBox({ busy, error, onConfirm, onCancel, t }: {
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="space-y-3 border border-border rounded-md p-3 bg-muted/30">
      <h4 className="text-sm font-semibold">{t('removeStampConfirmTitle')}</h4>
      <p className="text-sm text-muted-foreground">{t('removeStampConfirmBody')}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
          {busy ? t('removingStamp') : t('removeStampConfirmButton')}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>{t('deleteCancelButton')}</Button>
      </div>
    </div>
  )
}
