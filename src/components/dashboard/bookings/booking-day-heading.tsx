/** BOOK-004: a table day group's label: "Today · Thu 19 Nov", guests, "N need a reply". */
import { useLocale, useTranslations } from 'next-intl'
import type { DayGroup } from './booking-groups'
import { daySummary } from './booking-groups'
import { formatDate } from './booking-dates'

export function DayHeading({ group, today }: { group: DayGroup; today: string }) {
  const t = useTranslations('bookings.views')
  const locale = useLocale()
  const label = formatDate(group.date, locale, { weekday: 'short', day: 'numeric', month: 'short' })
  const s = daySummary(group.bookings)
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-semibold text-foreground">{group.date === today ? t('todayLabel', { date: label }) : label}</span>
      <span className="text-muted-foreground">
        {t('guests', { count: s.guests })}
        {s.pending > 0 ? ` · ${t('needReply', { count: s.pending })}` : ''}
      </span>
    </span>
  )
}
