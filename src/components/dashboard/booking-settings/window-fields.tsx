'use client'

/** BOOK-009 S1.2–S1.3: slot interval, minimum notice and how far ahead (fixed option lists). */
import { useTranslations } from 'next-intl'
import { AHEAD_OPTIONS, INTERVAL_OPTIONS, NOTICE_OPTIONS, type AheadDays, type NoticeHours } from '@/domain/value-objects/booking-hours'
import { Segmented } from './segmented'
import type { HoursEditProps } from './weekly-hours-table'

const selectClass = 'h-9 w-40 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

function Labelled({ id, label, hint, children }: { id?: string; label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      {id ? <label htmlFor={id} className="text-sm font-medium">{label}</label> : <p className="text-sm font-medium">{label}</p>}
      <p className="text-xs text-muted-foreground">{hint}</p>
      {children}
    </div>
  )
}

export function WindowFields({ hours, onEdit }: Omit<HoursEditProps, 'errors'>) {
  const t = useTranslations('bookingSettings.bookingHours')
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      <Labelled label={t('interval')} hint={t('intervalHint')}>
        <Segmented label={t('interval')} value={hours.intervalMinutes} testId="booking-settings-interval"
          options={INTERVAL_OPTIONS.map((n) => ({ value: n, label: t('minutes', { n }) }))}
          onChange={(intervalMinutes) => onEdit((h) => ({ ...h, intervalMinutes }))} />
      </Labelled>
      <Labelled id="booking-settings-notice" label={t('notice')} hint={t('noticeHint')}>
        <select id="booking-settings-notice" value={hours.noticeHours} data-testid="booking-settings-notice" className={selectClass}
          onChange={(e) => onEdit((h) => ({ ...h, noticeHours: Number(e.target.value) as NoticeHours }))}>
          {NOTICE_OPTIONS.map((n) => <option key={n} value={n}>{t('noticeOption', { n })}</option>)}
        </select>
      </Labelled>
      <Labelled id="booking-settings-ahead" label={t('ahead')} hint={t('aheadHint')}>
        <select id="booking-settings-ahead" value={hours.aheadDays} data-testid="booking-settings-ahead" className={selectClass}
          onChange={(e) => onEdit((h) => ({ ...h, aheadDays: Number(e.target.value) as AheadDays }))}>
          {AHEAD_OPTIONS.map((n) => <option key={n} value={n}>{t('aheadOption', { n })}</option>)}
        </select>
      </Labelled>
    </div>
  )
}
