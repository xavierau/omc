'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCampaignAudienceSettings, type CampaignAudienceSettings } from '@/hooks/use-campaign-audience-settings'
import { AudienceQualityCard } from './audience-quality-card'
import { WinbackCard } from './winback-card'
import { ThresholdsCard } from './thresholds-card'
import { CampaignSettingsSaveRow } from './campaign-settings-save-row'
import { useCampaignSettingsForm } from './use-campaign-settings-form'

/** CAMP-016: Settings → Campaigns (audience quality, win-back, thresholds). */
export function CampaignSettingsSection() {
  const t = useTranslations('campaignSettings')
  const { settings, error, reload } = useCampaignAudienceSettings()
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>
      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-sm">
          <span>{t('loadError')}</span>
          <Button variant="outline" size="sm" onClick={reload}>{t('retry')}</Button>
        </div>
      ) : settings ? (
        <CampaignSettingsForm settings={settings} />
      ) : (
        <Skeleton className="h-64 w-full rounded-xl" />
      )}
    </div>
  )
}

function CampaignSettingsForm({ settings }: { settings: CampaignAudienceSettings }) {
  const t = useTranslations('campaignSettings')
  const f = useCampaignSettingsForm(settings)
  const readOnly = !settings.canEdit
  return (
    <div className="space-y-6">
      {readOnly ? <p className="text-sm text-muted-foreground">{t('readOnly')}</p> : null}
      <AudienceQualityCard form={f.form} update={f.update} disabled={readOnly} />
      <WinbackCard
        value={f.form.lapsedDays}
        invalid={f.lapsedInvalid}
        onChange={(lapsedDays) => f.update({ lapsedDays })}
        disabled={readOnly}
      />
      <ThresholdsCard canExpand={settings.canEdit} />
      {readOnly ? null : (
        <CampaignSettingsSaveRow
          canSave={f.canSave}
          dirty={f.dirty}
          saving={f.saving}
          outcome={f.outcome}
          onSave={f.save}
          onDiscard={f.discard}
        />
      )}
    </div>
  )
}
