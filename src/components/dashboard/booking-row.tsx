'use client'

/**
 * BOOK-001 AC-13/AC-14: one booking request. Name and notes are diner input,
 * rendered as plain text only (R3). Pending rows offer Confirm and Decline
 * (with an optional reason); a decision whose message did not go out shows
 * the "contact the diner" badge, from this session or as stored (F9).
 * BOOK-003: a booking an AI agent made shows the "via AI agent" badge.
 * AGENT-003: a change request shows the slot it would replace (old → new);
 * a cancelled booking says whether the diner cancelled it through the AI
 * agent or a confirmed change replaced it.
 * BOOK-006: an original with an open change request shows "change requested
 * → new slot" and no Confirm/Decline: staff decide the pair on the change row.
 * BOOK-004: the day-list row (calendar day panel, phone day list): time and
 * party on the left; the badges and actions are shared with the table views.
 * A cancelled booking is greyed and struck through, like a declined chip.
 * BOOK-007: a past confirmed booking offers "Mark no-show"; a no-show is
 * muted like declined and offers "Undo".
 * BOOK-008: a linked booking's name opens the member panel; the row offers
 * Link member / Change member / Unlink member.
 * BOOK-009 AC-10: a booking whose diner accepted the booking terms shows
 * "Terms accepted"; hovering shows the text, tapping expands it (plain text).
 * BOOK-013: the ⋯ menu (Edit / Cancel), the "By staff · name" badge, and
 * Arrived / Undo on today's confirmed bookings.
 */
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bot, FileCheck } from 'lucide-react'
import { Badge, badgeVariants } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { BookingItem } from '@/hooks/use-bookings'
import { NoShowAction } from './bookings/booking-no-show-action'
import type { NoShowFn } from './bookings/use-booking-no-show'
import { BookingGuestName, MemberLinkControl } from './bookings/booking-member'
import { ArrivedAction, BookingRowMenu, CheckInRefusedLine, StaffSourceBadge } from './bookings/booking-staff-controls'

export type DecideFn = (id: string, decision: 'confirm' | 'decline', reason?: string) => void

export interface BookingRowProps {
  booking: BookingItem
  busy: boolean
  undelivered: boolean
  onDecide: DecideFn
  onNoShow?: NoShowFn
}

/** BOOK-004: pending = the accent amber family, confirmed = primary, declined, cancelled and no-show = muted. */
export const STATUS_TONE: Record<BookingItem['status'], string> = {
  unverified: 'border-border text-muted-foreground',
  pending: 'border-accent/40 bg-pending-soft text-pending-foreground',
  confirmed: 'border-primary/25 bg-primary/10 text-primary',
  declined: 'border-border bg-muted text-muted-foreground',
  cancelled: 'border-border bg-muted text-muted-foreground',
  no_show: 'border-border bg-muted text-muted-foreground',
}

/** A cancelled booking's time and guest are greyed and struck through (owner 2026-11-19). */
export function cancelledText(booking: BookingItem): string | false {
  return booking.status === 'cancelled' && 'text-muted-foreground line-through'
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

const CANCELLED_BY = {
  diner_ai: { id: 'diner', key: 'cancelledByDiner' },
  change: { id: 'change', key: 'replacedByChange' },
  staff: { id: 'staff', key: 'staff.cancelledByStaff' },
} as const

/** AGENT-003 R24/R23: who cancelled it, the diner through the AI agent or a confirmed change; BOOK-013: or staff. */
export function CancelledByBadge({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings')
  if (!booking.cancelledBy) return null
  const by = CANCELLED_BY[booking.cancelledBy] ?? CANCELLED_BY.change
  return (
    <Badge variant="outline" className="text-muted-foreground" data-testid={`booking-row-${booking.id}-cancelled-by-${by.id}`}>
      {t(by.key)}
    </Badge>
  )
}

/** BOOK-009 AC-10: the terms the diner accepted, as accepted (rendered as text, R3). */
export function TermsAccepted({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings')
  if (!booking.termsAcceptedAt || !booking.termsText) return null
  return (
    <details className="group text-sm" data-testid={`booking-row-${booking.id}-terms`}>
      <summary
        title={booking.termsText}
        className={cn(badgeVariants({ variant: 'outline' }), 'cursor-pointer list-none text-muted-foreground [&::-webkit-details-marker]:hidden')}
      >
        <FileCheck aria-hidden />
        {t('termsAccepted')}
      </summary>
      <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">{booking.termsText}</p>
    </details>
  )
}

type Slot = { bookingDate: string; bookingTime: string; partySize: number }
type Translate = ReturnType<typeof useTranslations<'bookings'>>
const slotText = (t: Translate, b: Slot) => `${b.bookingDate} ${b.bookingTime} · ${t('partyOf', { count: b.partySize })}`

/** AGENT-003 R23: a change request shows the slot it would replace (old → new). */
export function ChangeFromLine({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings')
  if (!booking.replacesBookingId) return null
  return (
    <p className="text-sm text-foreground" data-testid={`booking-row-${booking.id}-change-from`}>
      {booking.replaces ? t('changeFrom', { from: slotText(t, booking.replaces), to: slotText(t, booking) }) : t('changeRequest')}
    </p>
  )
}

/** BOOK-006: the original of an open change request: "change requested → new slot", decided on the change row. */
export function ChangePendingLine({ booking }: { booking: BookingItem }) {
  const t = useTranslations('bookings')
  if (!booking.openChange) return null
  return (
    <p className="text-sm font-medium text-pending-foreground" data-testid={`booking-row-${booking.id}-change-pending`}>
      {t('changePending', { to: slotText(t, booking.openChange) })}
    </p>
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

/**
 * Confirm / Decline for a pending booking; `stretch` = full-width buttons (phone cards).
 * BOOK-006: none on the original of an open change request (decided via the change row).
 */
export function RowActions({ booking, busy, onDecide, stretch = false }: Omit<BookingRowProps, 'undelivered'> & { stretch?: boolean }) {
  const t = useTranslations('bookings')
  const [declining, setDeclining] = useState(false)
  if (booking.status !== 'pending' || booking.openChange) return null
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

/** BOOK-013 decision 9 (AC-27): a staff booking may have no phone; "No phone" stands where the number goes. */
export function PhoneLink({ phone }: { phone: string | null }) {
  const t = useTranslations('bookings.staff')
  if (!phone) return <span className="inline-flex min-h-6 items-center">{t('noPhone')}</span>
  return (
    <a href={`tel:${phone}`} className="inline-flex min-h-6 items-center tabular-nums underline-offset-2 hover:underline">
      {phone}
    </a>
  )
}

export function BookingRow({ booking, busy, undelivered, onDecide, onNoShow }: BookingRowProps) {
  const t = useTranslations('bookings')
  return (
    <li data-testid={`booking-row-${booking.id}`} className={cn('flex gap-4 px-4 py-4 sm:px-5', booking.status === 'pending' && 'bg-pending-soft')}>
      <div className="w-12 shrink-0">
        <p className={cn('font-semibold tabular-nums text-foreground', cancelledText(booking))}>{booking.bookingTime}</p>
        <p className="text-xs text-muted-foreground">{t('pax', { count: booking.partySize })}</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <BookingGuestName booking={booking} className={cn('font-semibold break-words text-foreground', cancelledText(booking))} />
          <BookingStatusBadge booking={booking} />
          <AgentBadge booking={booking} />
          <StaffSourceBadge booking={booking} />
          <CancelledByBadge booking={booking} />
        </div>
        <ChangeFromLine booking={booking} />
        <ChangePendingLine booking={booking} />
        <p className="text-sm text-muted-foreground">
          <PhoneLink phone={booking.phone} />
        </p>
        <MemberLinkControl booking={booking} />
        <BookingNotes booking={booking} />
        <TermsAccepted booking={booking} />
        <NotDeliveredBadge booking={booking} undelivered={undelivered} />
        <CheckInRefusedLine booking={booking} />
        <div className="flex flex-wrap gap-2 pt-1 empty:hidden max-md:[&>div]:w-full max-md:[&>div>button]:flex-1">
          <RowActions booking={booking} busy={busy} onDecide={onDecide} />
          <NoShowAction booking={booking} busy={busy} onNoShow={onNoShow} />
          <ArrivedAction booking={booking} />
        </div>
      </div>
      <BookingRowMenu booking={booking} />
    </li>
  )
}
