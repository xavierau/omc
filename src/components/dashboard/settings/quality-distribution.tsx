'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { MemberQualityDistribution } from '@/hooks/use-member-quality-distribution'
import type { ContactQualityRating } from '@/domain/value-objects/contact-quality'
import { QUALITY_RATINGS, QUALITY_SOLID_CLASS, QUALITY_TESTID, qualityMeaningValues } from '../quality-meaning'

const COUNT_KEY: Record<ContactQualityRating, keyof MemberQualityDistribution> = {
  green: 'green', yellow: 'yellow', red: 'red', unknown: 'noData',
}

interface Props {
  data: MemberQualityDistribution | null
  loading: boolean
  error: boolean
  onRetry: () => void
}

function Bar({ data }: { data: MemberQualityDistribution }) {
  return (
    <div data-testid="settings-campaigns-quality-bar" className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
      {QUALITY_RATINGS.map((r) => {
        const n = data[COUNT_KEY[r]]
        return n > 0 ? <span key={r} className={QUALITY_SOLID_CLASS[r]} style={{ flexGrow: n }} /> : null
      })}
    </div>
  )
}

/** Always-visible legend: each colour with its count and its one-line meaning. */
export function QualityLegend({ data }: { data: MemberQualityDistribution | null }) {
  const t = useTranslations('contactQuality')
  const values = qualityMeaningValues()
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {QUALITY_RATINGS.map((r) => (
        <li key={r} data-testid={`settings-campaigns-quality-legend-${QUALITY_TESTID[r]}`} className="space-y-1">
          <span className="flex items-center gap-2 text-sm">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${QUALITY_SOLID_CLASS[r]}`} />
            <span className="font-medium text-foreground">{t(`label.${r}`)}</span>
            {data ? <span className="text-muted-foreground tabular-nums">{data[COUNT_KEY[r]].toLocaleString()}</span> : null}
          </span>
          <p className="text-sm text-muted-foreground">{t(`meaning.${r}`, { ...values })}</p>
        </li>
      ))}
    </ul>
  )
}

export function QualityDistribution({ data, loading, error, onRetry }: Props) {
  const t = useTranslations('campaignSettings')
  const { days } = qualityMeaningValues()
  if (error) {
    return (
      <div data-testid="settings-campaigns-quality-error" role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-sm">
        <span>{t('qualityError')}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button>
      </div>
    )
  }
  return (
    <div className="space-y-4" aria-busy={loading}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        {data ? <span className="font-semibold text-foreground">{t('activeMembers', { count: data.total })}</span> : <Skeleton className="h-4 w-32" />}
        <span className="text-muted-foreground">{t('lastDays', { days })}</span>
      </div>
      {loading ? <Skeleton className="h-2.5 w-full rounded-full" /> : null}
      {data && data.total === 0 ? (
        <p data-testid="settings-campaigns-quality-empty" className="text-sm text-muted-foreground">{t('qualityEmpty')}</p>
      ) : null}
      {data && data.total > 0 ? <Bar data={data} /> : null}
      <QualityLegend data={data} />
    </div>
  )
}
