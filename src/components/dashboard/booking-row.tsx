'use client'

/**
 * BOOK-001 AC-13/AC-14: one booking request. Name and notes are diner input,
 * rendered as plain text only (R3). Pending rows offer Confirm and Decline
 * (with an optional reason); a decision whose message did not go out shows
 * the "contact the diner" badge, from this session or as stored (F9).
 * BOOK-003: a booking an AI agent made shows the "via AI agent" badge.
 * BOOK-004: the day-list row (calendar day panel, phone day list): time and
 * party on the left; the badges and actions are shared with the table views.
 */
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bot } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { BookingItem } from '@/hooks/use-bookings'

export type DecideFn = (id: string, decision: 'confirm' | 'decline', reason?: string) => void

export interface BookingRowProps {
  booking: BookingItem
  busy: boolean
  undelivered: boolean
  onDecide: DecideFn
}

/** BOOK-004: pending = the accent amber family, confirmed = primary, declined = muted. */
export const STATUS_TONE: Record<BookingItem['status'], string> = {
  unverified: 'border-border text-muted-foreground',
  pending: 'border-accent/40 bg-pending-soft text-pending-foreground',
  confirmed: 'border-primary/25 bg-primary/10 text-primary',
  declined: 'border-border bg-muted text-muted-foreground',
}

export function BookingStatusBadge({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings')
  return (
    <Badge variant="outline" className={STATUS_TONE[booking.status]} data-testid={`booking-row-${booking.id}-status`}>
      {t(`status.${booking.status}`)}
    </Badge>
  )
}

export function AgentBadge({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings')
  if (booking.source !== 'agent') return null
  return (
    <Badge variant="outline" className="text-muted-foreground" data-testid={`booking-row-${booking.id}-via-agent`}>
      <Bot aria-hidden />
      {t('viaAgent')}
    </Badge>
  )
}

export function NotDeliveredBadge({ booking, undelivered, short = false }: { booking: BookingItem; undelivered: boolean; short?: boolean }) {
  const t = useTranslations('bookings')
  if (!undelivered && booking.decisionMessageStatus !== 'not_delivered') return null
  return (
    <Badge
      variant="outline"
      title={short ? t('notDelivered') : undefined}
      className={cn('border-destructive text-destructive', !short && 'h-auto text-left whitespace-normal')}
      data-testid={`booking-row-${booking.id}-not-delivered`}
    >
      {short ? t('notDeliveredShort') : t('notDelivered')}
    </Badge>
  )
}

function DeclineReason({ id, busy, onSend, onCancel }: { id: string; busy: boolean; onSend: (reason: string) => void; onCancel: () => void }) {
  const t = useTranslations('bookings')
  const [reason, setReason] = useState('')
  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row">
      <Input
        value={reason}
        maxLength={200}
        placeholder={t('declineReasonPlaceholder')}
        aria-label={t('declineReasonPlaceholder')}
        onChange={(e) => setReason(e.target.value)}
        data-testid={`booking-row-${id}-decline-reason`}
        className="h-9 min-w-40"
      />
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => onSend(reason)} data-testid={`booking-row-${id}-decline-send`}>
        {t('sendDecline')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {t('cancel')}
      </Button>
    </div>
  )
}

/** Confirm / Decline for a pending booking; `stretch` = full-width buttons (phone cards). */
export function RowActions({ booking, busy, onDecide, stretch = false }: Omit<BookingRowProps, 'undelivered'> & { stretch?: boolean }) {
  const t = useTranslations('bookings')
  const [declining, setDeclining] = useState(false)
  if (booking.status !== 'pending') return null
  if (declining) {
    return <DeclineReason id={booking.id} busy={busy} onCancel={() => setDeclining(false)} onSend={(r) => onDecide(booking.id, 'decline', r)} />
  }
  const size = stretch ? 'lg' : 'sm'
  return (
    <div className={cn('flex gap-2', stretch && 'w-full [&>*]:flex-1')}>
      <Button size={size} disabled={busy} onClick={() => onDecide(booking.id, 'confirm')} data-testid={`booking-row-${booking.id}-confirm`}>
        {t('confirm')}
      </Button>
      <Button size={size} variant="outline" disabled={busy} onClick={() => setDeclining(true)} data-testid={`booking-row-${booking.id}-decline`}>
        {t('decline')}
      </Button>
    </div>
  )
}

export function BookingNotes({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings')
  return (
    <>
      {booking.notes ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{booking.notes}</p> : null}
      {booking.status === 'declined' && booking.declineReason ? (
        <p className="text-xs text-muted-foreground">{t('declinedBecause', { reason: booking.declineReason })}</p>
      ) : null}
    </>
  )
}

export function PhoneLink({ phone }: { phone: string }) {
  return (
    <a href={`tel:${phone}`} className="inline-flex min-h-6 items-center tabular-nums underline-offset-2 hover:underline">
      {phone}
    </a>
  )
}

export function BookingRow({ booking, busy, undelivered, onDecide }: BookingRowProps) {
  const t = useTranslations('bookings')
  return (
    <li data-testid={`booking-row-${booking.id}`} className={cn('flex gap-4 px-4 py-4 sm:px-5', booking.status === 'pending' && 'bg-pending-soft')}>
      <div className="w-12 shrink-0">
        <p className="font-semibold tabular-nums text-foreground">{booking.bookingTime}</p>
        <p className="text-xs text-muted-foreground">{t('pax', { count: booking.partySize })}</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold break-words text-foreground">{booking.name ?? t('nameRemoved')}</span>
          <BookingStatusBadge booking={booking} />
          <AgentBadge booking={booking} />
        </div>
        <p className="text-sm text-muted-foreground">
          <PhoneLink phone={booking.phone} />
        </p>
        <BookingNotes booking={booking} />
        <NotDeliveredBadge booking={booking} undelivered={undelivered} />
        <div className="pt-1 empty:hidden max-md:[&>div]:w-full max-md:[&>div>button]:flex-1">
          <RowActions booking={booking} busy={busy} onDecide={onDecide} />
        </div>
      </div>
    </li>
  )
}
