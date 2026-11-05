'use client'

import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface RerunCampaignDialogProps {
  open: boolean
  busy: boolean
  qrOnlyCoupon?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

// A re-run messages real customers, so it takes an explicit second step (CAMP-014).
export function RerunCampaignDialog({ open, busy, qrOnlyCoupon, onOpenChange, onConfirm }: RerunCampaignDialogProps) {
  const t = useTranslations('campaigns')
  const tc = useTranslations('common')
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>{t('rerunConfirmTitle')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">{t('rerunConfirmBody')}</p>
          <p className="text-sm text-muted-foreground">{t('rerunCouponExpiry')}</p>
          {qrOnlyCoupon && (
            <div
              role="status"
              data-testid="campaign-rerun-qr-only-warning"
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
            >
              {t('qrOnlyWarningFailed')}
            </div>
          )}
          <div className="flex gap-2">
            <Button data-testid="campaign-rerun-confirm" disabled={busy} onClick={onConfirm}>
              {busy ? t('rerunning') : t('rerunConfirmAction')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
