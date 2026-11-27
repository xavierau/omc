'use client'

/**
 * BOOK-014 W4 (spec AC-12, AC-13, AC-14): a booking's deposit on every row.
 * One state badge (awaiting, paid, refund pending, refunded, kept, refund
 * failed) with the amount; "Deposit held HK$X" with Refund / Keep on a paid
 * deposit whose booking is cancelled or a no-show (Refund alone on a declined
 * one, whose automatic refund never started); Retry on a refund the provider
 * refused; Copy link on a staff booking still awaiting its deposit. The
 * server re-checks every move (R56, R58); this only decides what to offer.
 */
import { useTranslations } from 'next-intl'
import { Copy, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BookingItem } from '@/hooks/use-bookings'
import { depositRowActions } from '@/domain/entities/booking-deposit'
import type { DepositStatus } from '@/domain/entities/booking-deposit'
import { formatMoney } from '@/domain/value-objects/money'
import { useStaffBookingActions } from './use-staff-booking'

const TONE: Record<DepositStatus, string> = {
  awaiting: 'border-accent/40 bg-pending-soft text-pending-foreground',
  paid: 'border-primary/25 bg-primary/10 text-primary',
  lapsed: 'border-border text-muted-foreground',
  refund_pending: 'border-accent/40 text-pending-foreground',
  refunded: 'border-border bg-muted text-muted-foreground',
  kept: 'border-border bg-muted text-foreground',
  refund_failed: 'border-destructive text-destructive',
}

export function DepositBadge({ booking, className }: { booking: BookingItem; className?: string }) {
  const t = useTranslations('bookings.deposit')
  const d = booking.deposit
  if (!d) return null
  return (
    <Badge variant="outline" className={cn(TONE[d.status], className)} data-testid={`booking-deposit-badge-${booking.id}`} data-state={d.status}>
      <Wallet aria-hidden />
      {t(`state.${d.status}`, { amount: formatMoney(d.amount) })}
    </Badge>
  )
}

/** The deposit moves of one row; `stretch` = full-width buttons (phone cards). */
export function DepositActions({ booking, stretch = false }: { booking: BookingItem; stretch?: boolean }) {
  const t = useTranslations('bookings.deposit')
  const staff = useStaffBookingActions()
  const can = depositRowActions(booking)
  const d = booking.deposit
  if (!d || !(can.held || can.retry || can.copyLink)) return null
  const busy = staff.depositBusy.has(booking.id)
  const size = stretch ? 'lg' : 'sm'
  return (
    <div className={cn('flex flex-wrap items-center gap-2', stretch && 'w-full [&>button]:flex-1')} data-testid={`booking-row-${booking.id}-deposit-actions`}>
      {can.held ? (
        <span className="text-sm font-medium text-foreground" data-testid={`booking-row-${booking.id}-deposit-held`}>
          {t('held', { amount: formatMoney(d.amount) })}
        </span>
      ) : null}
      {can.refund ? (
        <Button size={size} variant="outline" disabled={busy} onClick={() => void staff.depositMove(booking.id, 'refund')} data-testid={`booking-row-${booking.id}-refund`}>
          {t('refund')}
        </Button>
      ) : null}
      {can.keep ? (
        <Button size={size} variant="outline" disabled={busy} onClick={() => void staff.depositMove(booking.id, 'keep')} data-testid={`booking-row-${booking.id}-keep`}>
          {t('keep')}
        </Button>
      ) : null}
      {can.retry ? (
        <Button size={size} variant="outline" disabled={busy} onClick={() => void staff.depositMove(booking.id, 'refund')} data-testid={`booking-row-${booking.id}-refund-retry`}>
          {t('retry')}
        </Button>
      ) : null}
      {can.copyLink ? (
        <Button size={size} variant="outline" disabled={busy} onClick={() => void staff.copyDepositLink(booking.id)} data-testid={`booking-row-${booking.id}-deposit-copy-link`}>
          <Copy aria-hidden />
          {t('copyLink')}
        </Button>
      ) : null}
    </div>
  )
}
