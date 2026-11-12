'use client'

/**
 * BOOK-001 AC-13/AC-14: one booking request. Name and notes are diner input,
 * rendered as plain text only (R3). Pending rows offer Confirm and Decline
 * (with an optional reason); a decision whose message did not go out shows
 * the "contact the diner" badge.
 */
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BookingItem } from '@/hooks/use-bookings'

export interface BookingRowProps {
  booking: BookingItem
  busy: boolean
  undelivered: boolean
  onDecide: (id: string, decision: 'confirm' | 'decline', reason?: string) => void
}

const STATUS_VARIANT = { pending: 'outline', confirmed: 'default', declined: 'destructive' } as const

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
        className="h-9"
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

function RowActions({ booking, busy, onDecide }: Omit<BookingRowProps, 'undelivered'>) {
  const t = useTranslations('bookings')
  const [declining, setDeclining] = useState(false)
  if (declining) {
    return <DeclineReason id={booking.id} busy={busy} onCancel={() => setDeclining(false)} onSend={(r) => onDecide(booking.id, 'decline', r)} />
  }
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={busy} onClick={() => onDecide(booking.id, 'confirm')} data-testid={`booking-row-${booking.id}-confirm`}>
        {t('confirm')}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeclining(true)} data-testid={`booking-row-${booking.id}-decline`}>
        {t('decline')}
      </Button>
    </div>
  )
}

export function BookingRow({ booking, busy, undelivered, onDecide }: BookingRowProps) {
  const t = useTranslations('bookings')
  return (
    <li data-testid={`booking-row-${booking.id}`} className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold tabular-nums text-foreground">
          {booking.bookingDate} {booking.bookingTime}
        </span>
        <span className="text-sm text-muted-foreground">{t('partyOf', { count: booking.partySize })}</span>
        <Badge variant={STATUS_VARIANT[booking.status]} data-testid={`booking-row-${booking.id}-status`}>
          {t(`status.${booking.status}`)}
        </Badge>
        {undelivered ? (
          <Badge variant="destructive" data-testid={`booking-row-${booking.id}-not-delivered`}>
            {t('notDelivered')}
          </Badge>
        ) : null}
      </div>
      <p className="text-sm text-foreground">
        {booking.name ?? t('nameRemoved')} · <a href={`tel:${booking.phone}`} className="tabular-nums underline-offset-2 hover:underline">{booking.phone}</a>
      </p>
      {booking.notes ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{booking.notes}</p> : null}
      {booking.status === 'declined' && booking.declineReason ? (
        <p className="text-xs text-muted-foreground">{t('declinedBecause', { reason: booking.declineReason })}</p>
      ) : null}
      {booking.status === 'pending' ? <RowActions booking={booking} busy={busy} onDecide={onDecide} /> : null}
    </li>
  )
}
