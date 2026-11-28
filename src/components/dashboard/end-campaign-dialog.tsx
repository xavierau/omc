'use client'

import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface EndCampaignDialogProps {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

// Honor-window confirm (plan §9). Ending a stamp card always opens a 14-day grace
// window so in-progress cards can still complete (the backend end() sets honor_until =
// now + 14d). The dialog makes that consequence explicit before confirming.
export function EndCampaignDialog({ open, busy, onOpenChange, onConfirm }: EndCampaignDialogProps) {
  const t = useTranslations('stampCampaigns')
  const tc = useTranslations('common')
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>{t('endConfirmTitle')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">{t('endConfirmBody')}</p>
          <div className="flex gap-2">
            <Button variant="destructive" disabled={busy} onClick={onConfirm}>
              {busy ? t('ending') : t('endHonor')}
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
