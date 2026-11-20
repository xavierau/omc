'use client'

/**
 * BOOK-007: "Mark no-show" on a confirmed booking whose time has passed
 * (Hong Kong) and that has no open change request (r1 F1), and "Undo" on a
 * no-show. The server re-checks both (R5); this only decides what to offer.
 * No handler, no action. "Now" is the screen's minute tick (r1 F5).
 */
import { useContext } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { canMarkNoShow } from '@/domain/services/booking-no-show'
import type { BookingItem } from '@/hooks/use-bookings'
import type { NoShowFn, NoShowNotice } from './use-booking-no-show'
import { BookingsNow } from './bookings-clock'

export interface NoShowActionProps {
  booking: BookingItem
  busy: boolean
  onNoShow?: NoShowFn
  stretch?: boolean
}

export function NoShowAction({ booking, busy, onNoShow, stretch = false }: NoShowActionProps) {
  const t = useTranslations('bookings')
  const now = useContext(BookingsNow)
  if (!onNoShow) return null
  const undo = booking.status === 'no_show'
  if (!undo && !canMarkNoShow(booking, now ?? new Date())) return null
  return (
    <div className={cn('flex', stretch && 'w-full [&>*]:flex-1')}>
      <Button
        size={stretch ? 'lg' : 'sm'}
        variant={undo ? 'ghost' : 'outline'}
        disabled={busy}
        onClick={() => onNoShow(booking.id, undo ? 'undo' : 'mark')}
        data-testid={`booking-row-${booking.id}-no-show${undo ? '-undo' : ''}`}
      >
        {t(undo ? 'undoNoShow' : 'markNoShow')}
      </Button>
    </div>
  )
}

const REFUSAL_KEY = { not_past: 'noShowNotPast', change_pending: 'noShowChangePending' } as const

/** BOOK-007: the notice of a no-show move that did not change the row; r1 F3: a refused mark says why. */
export function NoShowNoticeLine({ notice }: { notice: NoShowNotice }) {
  const t = useTranslations('bookings')
  if (!notice) return null
  const text =
    notice.kind === 'already_handled'
      ? t('alreadyHandled', { status: t(`alreadyHandledStatus.${notice.status}`) })
      : notice.kind === 'error'
        ? t('actionFailed')
        : t(REFUSAL_KEY[notice.kind])
  return (
    <p data-testid="booking-no-show-notice" data-kind={notice.kind} role="status" className="text-sm text-destructive">
      {text}
    </p>
  )
}
