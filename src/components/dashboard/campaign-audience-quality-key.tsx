'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { isSkippedRating } from '@/domain/value-objects/audience-filters'
import { QUALITY_RATINGS, QUALITY_SOLID_CLASS, qualityMeaningValues } from './quality-meaning'

/** Colour key: each rating with its short meaning and whether it receives at this skip level. */
export function CampaignAudienceQualityKey({ level }: { level: 'red' | 'red_yellow' }) {
  const t = useTranslations('campaigns')
  const tq = useTranslations('contactQuality')
  const values = qualityMeaningValues()
  return (
    <ul data-testid="campaign-audience-quality-key" className="space-y-1.5 rounded-lg bg-muted px-3 py-2.5">
      {QUALITY_RATINGS.map((r) => {
        const skipped = isSkippedRating(r, level)
        return (
          <li key={r} className="flex items-center gap-2 text-sm">
            <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', QUALITY_SOLID_CLASS[r])} />
            <span className="font-medium text-foreground">{tq(`label.${r}`)}</span>
            <span className="min-w-0 flex-1 text-muted-foreground">{tq(`short.${r}`, { ...values })}</span>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
              skipped ? 'bg-red-500/15 text-red-700 dark:text-red-300' : 'bg-background text-muted-foreground')}>
              {skipped ? t('skipped') : t('receives')}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
