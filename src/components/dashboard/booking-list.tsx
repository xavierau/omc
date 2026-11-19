/**
 * BOOK-001 AC-13: the result notice of the last confirm/decline.
 * BOOK-004: the day list (calendar day panel, phone day list), rows by time.
 */
import { useTranslations } from 'next-intl'
import { BookingRow, type DecideFn } from './booking-row'
import type { BookingItem, BookingNotice } from '@/hooks/use-bookings'

export interface BookingActionProps {
  busyId: string | null
  undelivered: ReadonlySet<string>
  onDecide: DecideFn
}

export interface BookingListProps extends BookingActionProps {
  bookings: BookingItem[]
}

export function BookingNoticeLine({ notice }: { notice: BookingNotice | null }) {
  const t = useTranslations('bookings')
  if (!notice) return null
  const text =
    notice.kind === 'sent'
      ? t(notice.decision === 'confirm' ? 'confirmationSent' : 'declineSent')
      : notice.kind === 'already_handled'
        ? t('alreadyHandled', { status: t(`alreadyHandledStatus.${notice.status}`) })
        : t('actionFailed')
  return (
    <p data-testid="booking-action-notice" data-kind={notice.kind} role="status" className={notice.kind === 'sent' ? 'text-sm text-foreground' : 'text-sm text-destructive'}>
      {text}
    </p>
  )
}

export function BookingList({ bookings, busyId, undelivered, onDecide }: BookingListProps) {
  return (
    <ul data-testid="booking-list" className="divide-y divide-border">
      {bookings.map((booking) => (
        <BookingRow
          key={booking.id}
          booking={booking}
          busy={busyId === booking.id}
          undelivered={undelivered.has(booking.id)}
          onDecide={onDecide}
        />
      ))}
    </ul>
  )
}
