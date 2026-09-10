'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { StampCampaignFormFields } from './stamp-campaign-form-fields'
import { mapCreateError } from './stamp-campaign-error-map'
import {
  initialStampCampaignForm,
  validateStampCampaignForm,
  buildStampCampaignBody,
  type StampCampaignFormState,
} from './stamp-campaign-form-types'
import { createStampCampaign } from '@/hooks/stamp-campaign-client'
import type { RewardItem } from '@/hooks/use-rewards'

interface StampCampaignFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  rewards: RewardItem[]
}

export function StampCampaignFormDialog({ open, onOpenChange, onSuccess, rewards }: StampCampaignFormDialogProps) {
  const t = useTranslations('stampCampaigns')
  const tc = useTranslations('common')
  const [form, setForm] = useState<StampCampaignFormState>(initialStampCampaignForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on close (covers outside-click + Cancel) rather than via an effect — keeps
  // the dialog free of the set-state-in-effect smell.
  const handleClose = () => {
    setForm(initialStampCampaignForm)
    setError(null)
    onOpenChange(false)
  }
  const handleChange = (key: keyof StampCampaignFormState, value: string) =>
    setForm((p) => ({ ...p, [key]: value }))

  async function handleSubmit() {
    const invalid = validateStampCampaignForm(form)
    if (invalid) { setError(t(invalid)); return }
    setSaving(true); setError(null)
    const out = await createStampCampaign(buildStampCampaignBody(form))
    setSaving(false)
    if (!out.ok) { setError(t(mapCreateError(out.error))); return }
    onSuccess(); handleClose()
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('create')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">
          {rewards.length === 0 ? (
            <NoRewardsBody />
          ) : (
            <>
              <StampCampaignFormFields form={form} rewards={rewards} onChange={handleChange} />
              {error && <p className="text-sm text-destructive mt-2">{error}</p>}
              <div className="flex gap-2 mt-6">
                <Button onClick={handleSubmit} disabled={saving}>{saving ? tc('creating') : tc('create')}</Button>
                <Button variant="outline" onClick={handleClose}>{tc('cancel')}</Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function NoRewardsBody() {
  const t = useTranslations('stampCampaigns')
  return (
    <EmptyState
      title={t('noRewardsTitle')}
      description={t('noRewardsBody')}
      actionLabel={t('goToRewards')}
      actionHref="/dashboard/rewards"
    />
  )
}
