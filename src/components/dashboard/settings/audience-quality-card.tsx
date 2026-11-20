'use client'

import { useTranslations } from 'next-intl'
import { Info } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useMemberQualityDistribution } from '@/hooks/use-member-quality-distribution'
import { qualityMeaningValues } from '../quality-meaning'
import { QualityDistribution } from './quality-distribution'
import { SkipLevelControl } from './skip-level-control'
import { skippedToday, type CampaignSettingsForm } from './campaign-settings-form'

interface Props {
  form: CampaignSettingsForm
  update: (patch: Partial<CampaignSettingsForm>) => void
  disabled: boolean
}

export function AudienceQualityCard({ form, update, disabled }: Props) {
  const t = useTranslations('campaignSettings')
  const dist = useMemberQualityDistribution()
  const showImpact = dist.data !== null && dist.data.total > 0
  return (
    <Card>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{t('qualityTitle')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('qualityDescription', { days: qualityMeaningValues().days })}</p>
        </div>
        <QualityDistribution data={dist.data} loading={dist.loading} error={dist.error} onRetry={dist.retry} />
        <div className="space-y-4 border-t pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p id="settings-campaigns-skip-label" className="font-medium text-foreground">{t('skipLabel')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('skipHint')}</p>
            </div>
            <Switch
              checked={form.skipEnabled}
              onCheckedChange={(skipEnabled) => update({ skipEnabled })}
              disabled={disabled}
              aria-labelledby="settings-campaigns-skip-label"
              data-testid="settings-campaigns-skip-toggle"
            />
          </div>
          {form.skipEnabled ? (
            <div className="space-y-3 border-l-2 border-border pl-4">
              <p className="text-sm font-medium text-foreground">{t('skipWhich')}</p>
              <SkipLevelControl value={form.skipLevel} onChange={(skipLevel) => update({ skipLevel })} disabled={disabled} />
              {showImpact ? (
                <p data-testid="settings-campaigns-skip-impact" className="flex gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm text-foreground">
                  <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  {t('skipImpact', { count: skippedToday(dist.data!, form.skipLevel) })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
