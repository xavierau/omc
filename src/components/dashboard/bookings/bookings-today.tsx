'use client'

/**
 * BOOK-013 S7 (mockup frames 7, 8): the Today view. One search box (name or
 * phone digits), the counters, and today's bookings with their arrival
 * state: Waiting, Late N min (15+), Arrived HH:MM (with Undo), No-show, Needs
 * reply. Staff find a diner by surname, time or phone and tap Arrived (owner
 * decision 8: no code, no QR). AC-25: sorted by Time (default), Name, Guests
 * or Status; Lunch / Dinner headings only while sorted by time. Desktop is a
 * table with sortable column headers; a phone gets cards and a Sort select.
 * Diner text renders as plain text.
 */
import { useContext, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { BookingItem } from '@/hooks/use-bookings'
import { RowActions, type DecideFn } from '@/components/dashboard/booking-row'
import { arrivalState, matchesTodaySearch, todayCounters, type ArrivalState } from '@/domain/services/booking-checkin'
import { sortTodayBookings, todayMealGroups, type TodaySort, type TodaySortKey } from '@/domain/services/booking-today-sort'
import { hongKongMoment } from '@/domain/services/booking-no-show'
import { BookingsNow } from './bookings-clock'
import { BookingGuestName } from './booking-member'
import { ArrivedAction, ArrivedTime, CheckInRefusedLine, StaffSourceBadge } from './booking-staff-controls'
import { TODAY_COLUMNS, TodaySortHeaderRow, TodaySortSelect } from './bookings-today-sort'
import type { BookingsTodayState } from './use-bookings-today'

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

interface RowProps {
  booking: BookingItem
  now: Date
  busy: boolean
  onDecide: DecideFn
}

/** The name, staff badge and phone: the column staff scan for a surname. A phone card adds the state chip beside the name. */
function NameCell({ booking, chip }: { booking: BookingItem; chip?: ReactNode }) {
  const t = useTranslations('bookings.staff')
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <BookingGuestName booking={booking} className="font-semibold break-words text-foreground" />
        {chip}
        <StaffSourceBadge booking={booking} />
      </div>
      <p className="text-sm tabular-nums text-muted-foreground">{booking.phone ?? t('noPhone')}</p>
      <CheckInRefusedLine booking={booking} />
    </div>
  )
}

/** Desktop (frame 7): one table row, Time | Name | Guests | Status | Action. */
function TodayTableRow({ booking, now, busy, onDecide }: RowProps) {
  const state = arrivalState(booking, hongKongMoment(now))
  return (
    <div role="row" data-testid={`booking-row-${booking.id}`} className={cn(TODAY_COLUMNS, 'px-5 py-3', state.kind === 'arrived' && 'bg-muted/40')}>
      <div role="cell" className="font-semibold tabular-nums text-foreground">{booking.bookingTime}</div>
      <div role="cell" className="min-w-0"><NameCell booking={booking} /></div>
      <div role="cell" className="tabular-nums text-foreground">{booking.partySize}</div>
      <div role="cell">{state.kind === 'arrived' ? <ArrivedTime booking={booking} /> : <StateChip booking={booking} state={state} />}</div>
      <div role="cell" className="flex flex-wrap items-center justify-end gap-2">
        <RowActions booking={booking} busy={busy} onDecide={onDecide} />
        <ArrivedAction booking={booking} withTime={false} />
      </div>
    </div>
  )
}

/** Phone (frame 8): a card per booking with a full-width action. */
function TodayCardRow({ booking, now, busy, onDecide }: RowProps) {
  const t = useTranslations('bookings')
  const state = arrivalState(booking, hongKongMoment(now))
  return (
    <li data-testid={`booking-row-${booking.id}`} className={cn('flex flex-col gap-2 px-4 py-3', state.kind === 'arrived' && 'bg-muted/40')}>
      <div className="flex min-w-0 items-start gap-4">
        <div className="w-12 shrink-0">
          <p className="font-semibold tabular-nums text-foreground">{booking.bookingTime}</p>
          <p className="text-xs text-muted-foreground">{t('pax', { count: booking.partySize })}</p>
        </div>
        <div className="min-w-0 flex-1">
          <NameCell booking={booking} chip={<StateChip booking={booking} state={state} />} />
        </div>
      </div>
      <div className="flex items-center gap-2 empty:hidden [&>*]:flex-1">
        <RowActions booking={booking} busy={busy} onDecide={onDecide} />
        <ArrivedAction booking={booking} />
      </div>
    </li>
  )
}

/** Lunch / Dinner headings while sorted by time; one plain run of rows otherwise. */
function grouped(bookings: BookingItem[], sort: TodaySort) {
  return sort.key === 'time' ? todayMealGroups(bookings) : [{ meal: null, bookings }]
}

interface ListProps {
  bookings: BookingItem[]
  sort: TodaySort
  onSort: (key: TodaySortKey) => void
  now: Date
  busyIds: ReadonlySet<string>
  onDecide: DecideFn
}

const MEAL_HEADING = 'px-5 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase'

function TodayTable({ bookings, sort, onSort, now, busyIds, onDecide }: ListProps) {
  const t = useTranslations('bookings.today')
  return (
    <div role="table" aria-label={t('listLabel')} data-testid="bookings-today-list" className="overflow-hidden rounded-xl border border-border bg-card">
      <div role="rowgroup"><TodaySortHeaderRow sort={sort} onSort={onSort} /></div>
      {grouped(bookings, sort).map((g) => (
        <div role="rowgroup" key={g.meal ?? 'all'} className="divide-y divide-border">
          {g.meal ? (
            <div role="row" data-testid={`bookings-today-group-${g.meal}`}>
              <div role="cell" className={cn(MEAL_HEADING, 'bg-muted/50')}>{t(`meal.${g.meal}`)}</div>
            </div>
          ) : null}
          {g.bookings.map((b) => <TodayTableRow key={b.id} booking={b} now={now} busy={busyIds.has(b.id)} onDecide={onDecide} />)}
        </div>
      ))}
    </div>
  )
}

function TodayCards({ bookings, sort, now, busyIds, onDecide }: Omit<ListProps, 'onSort'>) {
  const t = useTranslations('bookings.today')
  return (
    <div data-testid="bookings-today-list" className="overflow-hidden rounded-xl border border-border bg-card">
      {grouped(bookings, sort).map((g) => (
        <section key={g.meal ?? 'all'} aria-label={g.meal ? t(`meal.${g.meal}`) : undefined}>
          {g.meal ? <h3 data-testid={`bookings-today-group-${g.meal}`} className={cn(MEAL_HEADING, 'border-b border-border bg-muted/50 px-4')}>{t(`meal.${g.meal}`)}</h3> : null}
          <ul className="divide-y divide-border">
            {g.bookings.map((b) => <TodayCardRow key={b.id} booking={b} now={now} busy={busyIds.has(b.id)} onDecide={onDecide} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

export interface BookingsTodayProps {
  state: BookingsTodayState
  sort: TodaySort
  onSort: (key: TodaySortKey) => void
  onSortChange: (sort: TodaySort) => void
  isPhone: boolean
  busyIds: ReadonlySet<string>
  onDecide: DecideFn
}

function SearchBox({ state, matches }: { state: BookingsTodayState; matches: ReactNode }) {
  const t = useTranslations('bookings.today')
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="relative flex-1">
        <span className="sr-only">{t('searchLabel')}</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search" value={state.query} placeholder={t('searchPlaceholder')} onChange={(e) => state.setQuery(e.target.value)}
          data-testid="bookings-today-search" className="h-11 pl-9"
        />
      </label>
      {matches}
    </div>
  )
}

export function BookingsToday({ state, sort, onSort, onSortChange, isPhone, busyIds, onDecide }: BookingsTodayProps) {
  const t = useTranslations('bookings.today')
  const locale = useLocale()
  const now = useContext(BookingsNow) ?? new Date()
  const all = state.data?.bookings ?? []
  const shown = sortTodayBookings(all.filter((b) => matchesTodaySearch(b, state.query)), sort, { now: hongKongMoment(now), locale })
  const matches = state.query.trim() !== '' ? <span className="text-sm text-muted-foreground" data-testid="bookings-today-matches">{t('matches', { count: shown.length })}</span> : null
  const list = { bookings: shown, sort, now, busyIds, onDecide }
  return (
    <div data-testid="bookings-today" className="space-y-4">
      <SearchBox state={state} matches={matches} />
      {isPhone ? <TodaySortSelect sort={sort} onChange={onSortChange} /> : null}
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
          ) : isPhone ? <TodayCards {...list} /> : <TodayTable {...list} onSort={onSort} />}
        </>
      ) : null}
    </div>
  )
}
