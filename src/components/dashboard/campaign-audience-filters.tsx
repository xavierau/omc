'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Settings } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { LAPSED_DAYS_MAX, LAPSED_DAYS_MIN } from '@/domain/value-objects/audience-filters'
import type { CampaignAudienceSettings } from '@/hooks/use-campaign-audience-settings'
import { CampaignAudienceQualityKey } from './campaign-audience-quality-key'
import { lapsedDaysToSend, lapsedLocked, type AudienceFilterState } from './campaign-audience-filter-state'

interface Props {
  type: string
  filters: AudienceFilterState
  defaults: CampaignAudienceSettings | null
  onChange: (patch: Partial<AudienceFilterState>) => void
}

function LapsedRow({ type, filters, onChange }: Omit<Props, 'defaults'>) {
  const t = useTranslations('campaigns')
  const locked = lapsedLocked(type)
  const invalid = filters.lapsedEnabled && lapsedDaysToSend(filters) === undefined
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id="campaign-audience-lapsed-label" className="font-medium text-foreground">{t('lapsedToggle')}</p>
          <p className="text-sm text-muted-foreground">{t(locked ? 'lapsedWinbackHint' : 'lapsedToggleHint')}</p>
        </div>
        <Switch checked={filters.lapsedEnabled || locked} disabled={locked} onCheckedChange={(lapsedEnabled) => onChange({ lapsedEnabled })}
          aria-labelledby="campaign-audience-lapsed-label" data-testid="campaign-audience-lapsed-toggle" />
      </div>
      {filters.lapsedEnabled || locked ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <label htmlFor="campaign-audience-lapsed-days">{t('lapsedNoVisitFor')}</label>
            <Input id="campaign-audience-lapsed-days" type="number" inputMode="numeric" min={LAPSED_DAYS_MIN} max={LAPSED_DAYS_MAX}
              value={filters.lapsedDays} aria-invalid={invalid} onChange={(e) => onChange({ lapsedDays: e.target.value })}
              className="h-9 w-20" data-testid="campaign-audience-lapsed-days" />
            <span>{t('lapsedDaysOrMore')}</span>
          </div>
          {invalid ? <p className="text-sm text-destructive">{t('lapsedDaysInvalid')}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function QualityRow({ filters, defaults, onChange }: Omit<Props, 'type'>) {
  const t = useTranslations('campaigns')
  const hint = !filters.skipEnabled ? 'qualityHintOff' : filters.skipLevel === 'red_yellow' ? 'qualityHintRedYellow' : 'qualityHintRed'
  const defaultLevel = defaults?.skipContactQuality
  const defaultLabel = defaultLevel === 'red_yellow' ? t('qualityLevelRedYellow') : defaultLevel === 'red' ? t('qualityLevelRed') : t('defaultOff')
  return (
    <div className="space-y-3 border-t p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id="campaign-audience-quality-label" className="font-medium text-foreground">{t('qualityToggle')}</p>
          <p className="text-sm text-muted-foreground">{t(hint)}</p>
        </div>
        <Switch checked={filters.skipEnabled} onCheckedChange={(skipEnabled) => onChange({ skipEnabled })}
          aria-labelledby="campaign-audience-quality-label" data-testid="campaign-audience-quality-toggle" />
      </div>
      {filters.skipEnabled ? <CampaignAudienceQualityKey level={filters.skipLevel} /> : null}
      {defaults ? (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Settings aria-hidden className="h-4 w-4" />
          {t('defaultFromSettings', { level: defaultLabel })}
          <Link href="/dashboard/setup/campaigns" className="font-medium text-primary hover:underline">{t('changeDefault')}</Link>
        </p>
      ) : null}
    </div>
  )
}

/** CAMP-016: "Only lapsed customers" + "Skip low-quality contacts", combining with any audience. */
export function CampaignAudienceFilters(props: Props) {
  const t = useTranslations('campaigns')
  return (
    <fieldset className="rounded-lg border border-input">
      <legend className="sr-only">{t('audienceFiltersLabel')}</legend>
      <LapsedRow type={props.type} filters={props.filters} onChange={props.onChange} />
      <QualityRow filters={props.filters} defaults={props.defaults} onChange={props.onChange} />
    </fieldset>
  )
}
