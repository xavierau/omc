'use client'

/**
 * BOOK-009 S1.9–S1.10: the rules summary from GET (the same text the agents
 * get, refreshed after a save) and "預覽訂座頁", which opens the diner page
 * with the SAVED settings in a new tab.
 */
import { useTranslations } from 'next-intl'
import { ExternalLink, ListChecks } from 'lucide-react'
import type { BookingHoursSummaryText } from '@/hooks/use-booking-availability'

export const BOOKING_PREVIEW_PATH = '/dashboard/booking-preview'

export function HoursSummaryBox({ summary, dirty }: { summary: BookingHoursSummaryText | null; dirty: boolean }) {
  const t = useTranslations('bookingSettings.bookingHours')
  const text = summary ? (t('summaryLanguage') === 'en' ? summary.en : summary.zh_hk) : null
  return (
    <section className="space-y-2 rounded-lg bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-primary"><ListChecks className="size-4" aria-hidden />{t('summaryTitle')}</h3>
        <a href={BOOKING_PREVIEW_PATH} target="_blank" rel="noopener noreferrer" data-testid="booking-settings-preview"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary bg-background px-3 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <ExternalLink className="size-3.5" aria-hidden />{t('preview')}
        </a>
      </div>
      <p data-testid="booking-settings-summary" className="max-w-[75ch] text-sm leading-relaxed whitespace-pre-line text-foreground">{text ?? t('summaryNone')}</p>
      {dirty ? <p data-testid="booking-settings-preview-stale" className="text-xs text-muted-foreground">{t('previewStale')}</p> : null}
    </section>
  )
}
