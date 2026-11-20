'use client'

/**
 * BOOK-007: "Mark no-show" on a confirmed booking whose time has passed
 * (Hong Kong), and "Undo" on a no-show. The server re-checks both (R5); this
 * only decides what to offer. No handler, no action.
 */
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { canMarkNoShow } from '@/domain/services/booking-no-show'
import type { BookingItem } from '@/hooks/use-bookings'
import type { NoShowFn, NoShowNotice } from './use-booking-no-show'

export interface NoShowActionProps {
  booking: BookingItem
  busy: boolean
  onNoShow?: NoShowFn
  stretch?: boolean
}

export function NoShowAction({ booking, busy, onNoShow, stretch = false }: NoShowActionProps) {
  const t = useTranslations('bookings')
  if (!onNoShow) return null
  const undo = booking.status === 'no_show'
  if (!undo && !canMarkNoShow(booking, new Date())) return null
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

/** BOOK-007: the notice of a no-show move that did not change the row. */
export function NoShowNoticeLine({ notice }: { notice: NoShowNotice }) {
  const t = useTranslations('bookings')
  if (!notice) return null
  const text = notice.kind === 'already_handled' ? t('alreadyHandled', { status: t(`alreadyHandledStatus.${notice.status}`) }) : t('actionFailed')
  return (
    <p data-testid="booking-no-show-notice" data-kind={notice.kind} role="status" className="text-sm text-destructive">
      {text}
    </p>
  )
}
