'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useAudienceCount } from '@/hooks/use-audience-count'
import type { AudienceCounts } from '@/domain/value-objects/audience-query'
import { audienceCountBody, lapsedDaysToSend, type AudienceFilterState } from './campaign-audience-filter-state'

interface Props {
  form: AudienceFilterState & { type: string; targetAudience: 'all' | 'selected' | 'tag'; tagIds: string[]; memberIds: string[] }
}

const AUDIENCE_KEY = { all: 'summaryAll', selected: 'summarySelected', tag: 'summaryTags' } as const

function Row({ label, value, tone }: { label: string; value: string; tone?: 'minus' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={tone === 'minus' ? 'font-medium tabular-nums text-red-700 dark:text-red-300' : 'font-medium tabular-nums text-foreground'}>{value}</span>
    </div>
  )
}

function skippedCount(c: AudienceCounts, level: 'red' | 'red_yellow'): number {
  return level === 'red_yellow' ? c.red + c.yellow : c.red
}

/** Audience → after last-visit filter → skipped → Will receive (same resolver as the send). */
export function CampaignAudienceSummary({ form }: Props) {
  const t = useTranslations('campaigns')
  const body = audienceCountBody(form)
  const { counts, loading, error, retry } = useAudienceCount(body)
  if (!body) return null
  const show = (n: number | undefined) => (loading || n === undefined ? t('summaryCalculating') : n.toLocaleString())
  const lapsedDays = lapsedDaysToSend(form)
  return (
    <div data-testid="campaign-audience-summary" aria-busy={loading} className="space-y-2.5 rounded-lg bg-muted px-4 py-3">
      {error ? (
        <div data-testid="campaign-audience-summary-error" role="alert" className="flex items-center justify-between gap-3 text-sm">
          <span>{t('summaryError')}</span>
          <Button variant="outline" size="sm" onClick={retry}>{t('summaryRetry')}</Button>
        </div>
      ) : (
        <>
          <Row label={t(AUDIENCE_KEY[form.targetAudience])} value={show(counts?.audience)} />
          {lapsedDays ? <Row label={t('summaryLapsed', { days: lapsedDays })} value={show(counts?.afterLapsed)} /> : null}
          {form.skipEnabled ? (
            <Row
              label={t(form.skipLevel === 'red_yellow' ? 'summarySkippedRedYellow' : 'summarySkippedRed')}
              value={loading || !counts ? t('summaryCalculating') : `− ${skippedCount(counts, form.skipLevel).toLocaleString()}`}
              tone="minus"
            />
          ) : null}
          <div className="flex items-baseline justify-between gap-3 border-t pt-2.5">
            <span className="font-semibold text-foreground">{t('summaryWillReceive')}</span>
            <span data-testid="campaign-audience-summary-will-receive" className="text-xl font-semibold tabular-nums text-foreground">
              {show(counts?.willReceive)}
            </span>
          </div>
          {!loading && counts?.willReceive === 0 ? (
            <p data-testid="campaign-audience-zero-warning" role="status" className="text-sm font-medium text-amber-700 dark:text-amber-300">
              {t('summaryZero')}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('summaryFootnote')}</p>
        </>
      )}
    </div>
  )
}
