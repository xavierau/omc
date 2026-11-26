'use client'

/**
 * BOOK-008 (R8): the member panel's Bookings section: the stats over all of
 * the member's bookings, then the newest 50 (date, time, party, status). The
 * list and stats come with the member detail (bookingHistory); null means
 * they could not be read, and the rest of the panel is unaffected.
 */
import { useLocale, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { MemberBookingHistory, MemberBookingItem, MemberBookingStats } from '@/domain/entities/member-booking'
import { STATUS_TONE } from './booking-row'
import { formatDate } from './bookings/booking-dates'

const DATE = { day: 'numeric', month: 'short', year: 'numeric' } as const
/** A date needs more room than a count: its own row on a phone, one column from sm up. */
const WIDE = 'col-span-3 sm:col-span-1'
const COUNTS = [
  ['total', 'bookingStatTotal'],
  ['confirmed', 'bookingStatConfirmed'],
  ['noShow', 'bookingStatNoShow'],
  // BOOK-013 (AC-23): diners checked in.
  ['arrived', 'bookingStatArrived'],
  ['cancelled', 'bookingStatCancelled'],
  ['declined', 'bookingStatDeclined'],
  ['pending', 'bookingStatPending'],
] as const

function Stat({ label, value, testId, className }: { label: string; value: string | number; testId: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums" data-testid={testId}>{value}</dd>
    </div>
  )
}

export function MemberBookingStatsGrid({ stats }: { stats: MemberBookingStats }) {
  const t = useTranslations('members')
  const locale = useLocale()
  const day = (d: string | null) => (d ? formatDate(d, locale, DATE) : '—')
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm" data-testid="member-bookings-stats">
      {COUNTS.map(([key, label]) => (
        <Stat key={key} label={t(label)} value={stats[key] ?? 0} testId={`member-bookings-stat-${key}`} />
      ))}
      <Stat label={t('lastBooking')} value={day(stats.lastBookingDate)} testId="member-bookings-stat-last" className={WIDE} />
      <Stat label={t('nextBooking')} value={day(stats.nextBookingDate)} testId="member-bookings-stat-next" className={WIDE} />
    </dl>
  )
}

function MemberBookingLine({ booking }: { booking: MemberBookingItem }) {
  const t = useTranslations('bookings')
  const locale = useLocale()
  return (
    <li className="flex items-center justify-between gap-3 text-sm" data-testid={`member-booking-row-${booking.id}`}>
      <span className="min-w-0 tabular-nums">
        {formatDate(booking.bookingDate, locale, DATE)} · {booking.bookingTime} · {t('pax', { count: booking.partySize })}
      </span>
      <Badge variant="outline" className={STATUS_TONE[booking.status]}>{t(`status.${booking.status}`)}</Badge>
    </li>
  )
}

export function MemberBookingsSection({ history }: { history: MemberBookingHistory | null | undefined }) {
  const t = useTranslations('members')
  return (
    <section data-testid="member-bookings">
      <h3 className="mb-3 text-sm font-semibold">{t('bookingsSection')}</h3>
      {!history ? (
        <p className="text-sm text-muted-foreground" data-testid="member-bookings-unavailable">{t('bookingsUnavailable')}</p>
      ) : history.stats.total === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="member-bookings-empty">{t('noBookings')}</p>
      ) : (
        <div className="space-y-4">
          <MemberBookingStatsGrid stats={history.stats} />
          <ul className="space-y-2">
            {history.bookings.map((b) => <MemberBookingLine key={b.id} booking={b} />)}
          </ul>
          {history.stats.total > history.bookings.length ? (
            <p className="text-xs text-muted-foreground">{t('bookingsShownOf', { shown: history.bookings.length, total: history.stats.total })}</p>
          ) : null}
        </div>
      )}
    </section>
  )
}
