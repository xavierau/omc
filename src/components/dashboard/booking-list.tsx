/**
 * BOOK-001 AC-13: the Bookings list (newest first, as the API returns it),
 * its empty state, and the result notice of the last confirm/decline.
 */
import { useTranslations } from 'next-intl'
import { EmptyState } from '@/components/shared/empty-state'
import { BookingRow } from './booking-row'
import type { BookingItem, BookingNotice } from '@/hooks/use-bookings'

export interface BookingListProps {
  bookings: BookingItem[]
  busyId: string | null
  undelivered: ReadonlySet<string>
  notice: BookingNotice | null
  onDecide: (id: string, decision: 'confirm' | 'decline', reason?: string) => void
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

export function BookingList({ bookings, busyId, undelivered, notice, onDecide }: BookingListProps) {
  const t = useTranslations('bookings')
  if (bookings.length === 0) {
    return (
      <div data-testid="booking-list-empty">
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <BookingNoticeLine notice={notice} />
      <ul data-testid="booking-list" className="divide-y divide-border rounded-lg border border-border bg-card px-4">
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
    </div>
  )
}
