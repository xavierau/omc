'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LAPSED_DAYS_MAX, LAPSED_DAYS_MIN } from '@/domain/value-objects/audience-filters'

interface Props {
  value: string
  invalid: boolean
  onChange: (value: string) => void
  disabled: boolean
}

export function WinbackCard({ value, invalid, onChange, disabled }: Props) {
  const t = useTranslations('campaignSettings')
  return (
    <Card>
      <CardContent className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{t('winbackTitle')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('winbackDescription')}</p>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-60">
            <label htmlFor="settings-campaigns-lapsed-days" className="font-medium text-foreground">{t('lapsedLabel')}</label>
            <p className="mt-1 text-sm text-muted-foreground">{t('lapsedHint')}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                id="settings-campaigns-lapsed-days"
                type="number"
                inputMode="numeric"
                min={LAPSED_DAYS_MIN}
                max={LAPSED_DAYS_MAX}
                value={value}
                disabled={disabled}
                aria-invalid={invalid}
                aria-describedby={invalid ? 'settings-campaigns-lapsed-days-error' : undefined}
                onChange={(e) => onChange(e.target.value)}
                className="h-10 w-24"
                data-testid="settings-campaigns-lapsed-days"
              />
              <span className="text-sm text-muted-foreground">{t('days')}</span>
            </div>
            {invalid ? (
              <p id="settings-campaigns-lapsed-days-error" data-testid="settings-campaigns-lapsed-days-error" className="text-sm text-destructive">
                {t('lapsedError')}
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
