'use client'

import { useTranslations } from 'next-intl'
import { ChevronDown, Lock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { qualityMeaningValues } from '../quality-meaning'

/** D2: read-only in this slice. Admins can expand it; others see the summary only (no chevron). */
export function ThresholdsCard({ canExpand }: { canExpand: boolean }) {
  const t = useTranslations('campaignSettings')
  const v = qualityMeaningValues()
  const summary = (
    <div className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">{t('thresholdsTitle')}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <Lock aria-hidden className="h-3 w-3" />
          {t('adminsOnly')}
        </span>
      </span>
      <span className="mt-1 block text-sm text-muted-foreground">{t('thresholdsSummary', { ...v })}</span>
    </div>
  )
  return (
    <Card data-testid="settings-campaigns-thresholds">
      <CardContent>
        {canExpand ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-4 [&::-webkit-details-marker]:hidden">
              {summary}
              <ChevronDown aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-3 text-sm text-muted-foreground">{t('thresholdsReadOnly')}</p>
          </details>
        ) : (
          summary
        )}
      </CardContent>
    </Card>
  )
}
