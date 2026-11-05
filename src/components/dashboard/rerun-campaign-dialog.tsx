'use client'

import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface RerunCampaignDialogProps {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

// A re-run messages real customers, so it takes an explicit second step (CAMP-014).
export function RerunCampaignDialog({ open, busy, onOpenChange, onConfirm }: RerunCampaignDialogProps) {
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
