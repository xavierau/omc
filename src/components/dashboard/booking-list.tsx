/**
 * BOOK-001 AC-13: the result notice of the last confirm/decline.
 * BOOK-004: the day list (calendar day panel, phone day list), rows by time.
 * BOOK-007: rows also carry the mark / undo no-show action.
 */
import { useTranslations } from 'next-intl'
import { BookingRow, type DecideFn } from './booking-row'
import type { BookingItem, BookingNotice } from '@/hooks/use-bookings'
import type { NoShowFn } from './bookings/use-booking-no-show'

export interface BookingActionProps {
  busyId: string | null
  undelivered: ReadonlySet<string>
  onDecide: DecideFn
  /** BOOK-007: mark / undo a no-show; without it no row offers the action. */
  onNoShow?: NoShowFn
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

export function BookingList({ bookings, busyId, undelivered, onDecide, onNoShow }: BookingListProps) {
  return (
    <ul data-testid="booking-list" className="divide-y divide-border">
      {bookings.map((booking) => (
        <BookingRow
          key={booking.id}
          booking={booking}
          busy={busyId === booking.id}
          undelivered={undelivered.has(booking.id)}
          onDecide={onDecide}
          onNoShow={onNoShow}
        />
      ))}
    </ul>
  )
}
