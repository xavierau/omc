'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface Props {
  canSave: boolean
  dirty: boolean
  saving: boolean
  outcome: 'saved' | 'error' | null
  onSave: () => void
  onDiscard: () => void
}

/** One save for the whole group: "Changes apply to campaigns created after you save." */
export function CampaignSettingsSaveRow({ canSave, dirty, saving, outcome, onSave, onDiscard }: Props) {
  const t = useTranslations('campaignSettings')
  return (
    <div className="space-y-2">
      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-end">
        <p className="text-center text-sm text-muted-foreground md:text-right">{t('saveNote')}</p>
        <div className="flex gap-3">
          <Button variant="outline" size="lg" onClick={onDiscard} disabled={!dirty || saving} className="hidden md:inline-flex">
            {t('discard')}
          </Button>
          <Button size="lg" onClick={onSave} disabled={!canSave || saving} className="flex-1 md:flex-none" data-testid="settings-campaigns-save">
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
      {outcome === 'saved' ? (
        <p data-testid="settings-campaigns-saved" role="status" className="text-sm text-green-700 md:text-right dark:text-green-300">{t('saved')}</p>
      ) : null}
      {outcome === 'error' ? (
        <p data-testid="settings-campaigns-save-error" role="alert" className="text-sm text-destructive md:text-right">{t('saveError')}</p>
      ) : null}
    </div>
  )
}
