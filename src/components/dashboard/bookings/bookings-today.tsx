'use client'

/**
 * BOOK-013 S7 (mockup frames 7, 8): the Today view. One search box (name,
 * phone digits, code), Scan QR (the existing html5-qrcode scanner), the
 * counters, and today's bookings by time with their arrival state: Waiting,
 * Late N min (15+), Arrived HH:MM (with Undo), No-show, Needs reply. A whole
 * code opens its booking card; a booking of another day says so and offers
 * no Arrived. Diner text renders as plain text.
 */
import { useContext } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { QrCode, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { QrScanner } from '@/components/dashboard/qr-scanner'
import { cn } from '@/lib/utils'
import type { BookingItem } from '@/hooks/use-bookings'
import { RowActions, type DecideFn } from '@/components/dashboard/booking-row'
import { arrivalState, canCheckIn, matchesTodaySearch, todayCounters, type ArrivalState } from '@/domain/services/booking-checkin'
import { hongKongMoment } from '@/domain/services/booking-no-show'
import { BookingsNow } from './bookings-clock'
import { formatDate } from './booking-dates'
import { BookingGuestName } from './booking-member'
import { ArrivedAction, CheckInRefusedLine, CheckinCode, StaffSourceBadge } from './booking-staff-controls'
import { useStaffBookingActions } from './use-staff-booking'
import type { BookingsTodayState } from './use-bookings-today'
import type { CodeLookup } from './staff-booking-api'

const STATE_TONE: Record<ArrivalState['kind'], string> = {
  arrived: 'border-primary/25 bg-primary/10 text-primary',
  late: 'border-destructive/40 bg-destructive/5 text-destructive',
  waiting: 'border-border text-muted-foreground',
  no_show: 'border-border bg-muted text-muted-foreground',
  needs_reply: 'border-accent/40 bg-pending-soft text-pending-foreground',
  other: 'border-border text-muted-foreground',
}

function StateChip({ booking, state }: { booking: BookingItem; state: ArrivalState }) {
  const t = useTranslations('bookings.today')
  if (state.kind === 'arrived' || state.kind === 'other') return null
  const text =
    state.kind === 'late' ? t('stateLate', { minutes: state.minutes })
      : state.kind === 'no_show' ? t('stateNoShow')
        : state.kind === 'needs_reply' ? t('stateNeedsReply')
          : t('stateWaiting')
  return (
    <span data-testid={`booking-row-${booking.id}-arrival`} data-state={state.kind} className={cn('inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium', STATE_TONE[state.kind])}>
      {text}
    </span>
  )
}

function Counters({ bookings, now }: { bookings: BookingItem[]; now: Date }) {
  const t = useTranslations('bookings.today')
  const c = todayCounters(bookings, hongKongMoment(now))
  const items = [
    { key: 'arrived', value: `${c.guestsArrived} / ${c.guestsExpected}`, label: t('guestsArrived') },
    { key: 'waiting', value: String(c.waiting), label: t('waiting') },
    { key: 'late', value: String(c.late), label: t('late') },
    { key: 'no-show', value: String(c.noShow), label: t('noShow') },
  ]
  return (
    <dl data-testid="bookings-today-counter" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.key} className="rounded-xl border border-border bg-card px-4 py-3" data-testid={`bookings-today-counter-${i.key}`}>
          <dt className="sr-only">{i.label}</dt>
          <dd className="text-xl font-semibold tabular-nums text-foreground">{i.value}</dd>
          <dd className="text-sm text-muted-foreground">{i.label}</dd>
        </div>
      ))}
    </dl>
  )
}

function TodayRow({ booking, now, busy, onDecide }: { booking: BookingItem; now: Date; busy: boolean; onDecide: DecideFn }) {
  const t = useTranslations('bookings')
  const state = arrivalState(booking, hongKongMoment(now))
  return (
    <li data-testid={`booking-row-${booking.id}`} className={cn('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5', state.kind === 'arrived' && 'bg-muted/40')}>
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className="w-12 shrink-0">
          <p className="font-semibold tabular-nums text-foreground">{booking.bookingTime}</p>
          <p className="text-xs text-muted-foreground">{t('pax', { count: booking.partySize })}</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <BookingGuestName booking={booking} className="font-semibold break-words text-foreground" />
            <StaffSourceBadge booking={booking} />
            <StateChip booking={booking} state={state} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span className="tabular-nums">{booking.phone}</span>
            {booking.checkinCode ? <span aria-hidden>·</span> : null}
            <CheckinCode booking={booking} />
          </p>
          <CheckInRefusedLine booking={booking} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 max-sm:[&>*]:flex-1 sm:justify-end">
        <RowActions booking={booking} busy={busy} onDecide={onDecide} />
        <ArrivedAction booking={booking} />
      </div>
    </li>
  )
}

/** Frame 7/8c: the booking a code belongs to; Arrived only when it is today's and can check in. */
export function CodeResultCard({ lookup, today }: { lookup: CodeLookup; today: string }) {
  const t = useTranslations('bookings.today')
  const ts = useTranslations('bookings.staff')
  const staff = useStaffBookingActions()
  const locale = useLocale()
  if (lookup.kind !== 'found') {
    return (
      <p data-testid="booking-scan-not-found" role="status" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {t('notFound')}
      </p>
    )
  }
  const b = lookup.booking
  const isToday = lookup.today && b.bookingDate === today
  return (
    <section data-testid="booking-scan-result" className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t(isToday ? 'codeToday' : 'codeOtherDay', { code: b.checkinCode ?? '' })}
      </p>
      <h3 className="text-lg font-semibold break-words text-foreground">{b.name ?? b.phone} · {b.partySize}</h3>
      {isToday ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('timeLabel')}</dt>
          <dd className="tabular-nums text-foreground">{b.bookingTime}</dd>
          <dt className="text-muted-foreground">{t('phone')}</dt>
          <dd className="tabular-nums text-foreground">{b.phone}</dd>
          {b.notes ? (
            <>
              <dt className="text-muted-foreground">{t('notes')}</dt>
              <dd className="whitespace-pre-wrap break-words text-foreground">{b.notes}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('otherDayHint', { date: formatDate(b.bookingDate, locale, { weekday: 'short', day: 'numeric', month: 'short' }), time: b.bookingTime })}
        </p>
      )}
      {b.checkedInAt || (isToday && canCheckIn(b, today)) ? (
        <div className="flex flex-wrap gap-2">
          <ArrivedAction booking={b} stretch />
        </div>
      ) : null}
      {isToday && b.status === 'confirmed' && !b.openChange ? (
        <Button variant="outline" onClick={() => staff.openEdit(b)} className="self-start">{ts('edit')}</Button>
      ) : null}
    </section>
  )
}

function ScanSheet({ today, state }: { today: string; state: BookingsTodayState }) {
  const t = useTranslations('bookings.today')
  const scan = state.scan
  const open = scan.kind !== 'closed'
  return (
    <Sheet open={open} onOpenChange={(o) => !o && state.closeScan()}>
      <SheetContent side="bottom" className="max-h-[92dvh] gap-3 overflow-y-auto rounded-t-2xl p-0 md:right-auto! md:bottom-auto! md:left-1/2! md:top-[6vh] md:w-[min(480px,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-xl md:border" data-testid="bookings-today-scan-sheet">
        <SheetHeader className="pr-12">
          <SheetTitle className="text-lg font-semibold">{t('scanTitle')}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {scan.kind === 'scanning' ? (
            <>
              <div className="overflow-hidden rounded-xl bg-black"><QrScanner active onScan={(text) => void state.onScanned(text)} /></div>
              <p className="text-center text-sm text-muted-foreground">{t('scanHint')}</p>
            </>
          ) : null}
          {scan.kind === 'camera_denied' ? (
            <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">{t('cameraDenied')}</p>
              <p className="mt-1 text-muted-foreground">{t('cameraHint')}</p>
            </div>
          ) : null}
          {scan.kind === 'result' ? <CodeResultCard lookup={scan.lookup} today={today} /> : null}
          {scan.kind === 'result' || scan.kind === 'camera_denied' ? (
            <Button variant="outline" size="lg" onClick={state.scanAgain}>{t('scan')}</Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export interface BookingsTodayProps {
  state: BookingsTodayState
  today: string
  busyIds: ReadonlySet<string>
  onDecide: DecideFn
}

export function BookingsToday({ state, today, busyIds, onDecide }: BookingsTodayProps) {
  const t = useTranslations('bookings.today')
  const now = useContext(BookingsNow) ?? new Date()
  const all = state.data?.bookings ?? []
  const shown = all.filter((b) => matchesTodaySearch(b, state.query))
  const searching = state.query.trim() !== ''
  return (
    <div data-testid="bookings-today" className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">{t('searchLabel')}</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search" value={state.query} placeholder={t('searchPlaceholder')} onChange={(e) => state.setQuery(e.target.value)}
            data-testid="bookings-today-search" className="h-11 pl-9"
          />
        </label>
        {searching ? <span className="text-sm text-muted-foreground" data-testid="bookings-today-matches">{t('matches', { count: shown.length })}</span> : null}
        <Button variant="outline" size="lg" onClick={state.openScan} data-testid="bookings-today-scan" className="h-11">
          <QrCode aria-hidden />
          {t('scan')}
        </Button>
      </div>
      {state.codeCard ? <CodeResultCard lookup={state.codeCard} today={today} /> : null}
      {state.loading ? <p className="text-sm text-muted-foreground">{t('loading')}</p> : null}
      {state.failed ? <p role="alert" className="text-sm text-destructive">{t('couldntLoad')}</p> : null}
      {state.data ? (
        <>
          <Counters bookings={all} now={now} />
          {state.data.truncated ? <p className="text-sm text-muted-foreground" data-testid="bookings-today-truncated">{t('truncated', { count: all.length })}</p> : null}
          {shown.length === 0 ? (
            <p data-testid="bookings-today-empty" className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
              {all.length === 0 ? t('emptyDay') : t('empty')}
            </p>
          ) : (
            <ul data-testid="bookings-today-list" className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {shown.map((b) => <TodayRow key={b.id} booking={b} now={now} busy={busyIds.has(b.id)} onDecide={onDecide} />)}
            </ul>
          )}
        </>
      ) : null}
      <ScanSheet today={today} state={state} />
    </div>
  )
}

