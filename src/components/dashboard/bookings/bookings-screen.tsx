'use client'

/**
 * BOOK-004: the Bookings page: header (needs-reply pill, view toggle),
 * toolbar (month nav or range; status chips + search), then the Calendar or
 * Table view over the fetched date range. Loading / error + Retry / notices
 * keep their BOOK-001 test ids. BOOK-007: rows mark / undo a no-show; r1:
 * one busy set and notice across both kinds of action (F4), and a minute tick
 * so a booking whose time passes gets its Mark no-show (F5).
 * BOOK-008: a linked booking's name opens the member panel here, and rows
 * link / change / unlink their member (BookingMemberContext).
 * BOOK-010: the Calendar's Capacity block (stop / resume) and month badges,
 * and the over-limit confirm prompt; a decision also reloads the capacity.
 * BOOK-013: staff add / edit / cancel (StaffBookingContext: the form, rules
 * prompt, cancel dialog, toast), the Today view with search, scan and
 * Arrived, and "Bookings are off" when the restaurant's booking mode is off.
 */
import { useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { CalendarOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBookingAvailability } from '@/hooks/use-booking-availability'
import { BookingsToday } from './bookings-today'
import { useBookingsToday } from './use-bookings-today'
import { StaffBookingContext, useStaffBooking } from './use-staff-booking'
import { BookingToast, CancelBookingDialog, StaffBookingFormDialog } from './staff-booking-dialogs'
import { BookingNoticeLine } from '@/components/dashboard/booking-list'
import { NoShowNoticeLine } from './booking-no-show-action'
import { useBookingRowActions } from './use-booking-row-actions'
import { BookingsNow, useMinuteTick } from './bookings-clock'
import { useBookings } from '@/hooks/use-bookings'
import { bookingsPageLists } from './booking-groups'
import { BookingsCalendar } from './bookings-calendar'
import { BookingsFilters } from './bookings-filters'
import { BookingsHeader } from './bookings-header'
import { BookingsTable } from './bookings-table'
import { CalendarNav, TableRangeControl } from './bookings-toolbar'
import { useBookingsPage } from './use-bookings-page'
import { MemberDetailPanel } from '@/components/dashboard/member-detail-panel'
import { MemberLinkNoticeLine } from './booking-member'
import { BookingMemberContext, useBookingMemberLink, type BookingMemberActions } from './use-booking-member'
import { useBookingCapacity } from './use-booking-capacity'
import { DayCapacity } from './capacity-block'
import { OverLimitFor } from './over-limit-prompt'
import { gridRange } from './booking-dates'

export function BookingsLoading() {
  const t = useTranslations('bookings')
  return <p data-testid="booking-list-loading" className="text-sm text-muted-foreground">{t('loading')}</p>
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('bookings')
  const tc = useTranslations('common')
  return (
    <div data-testid="booking-list-error" className="flex flex-col items-center gap-3 py-12">
      <p className="text-muted-foreground">{t('couldntLoad')}</p>
      <Button variant="outline" onClick={onRetry}>{tc('retry')}</Button>
    </div>
  )
}

/** The minute tick (BOOK-007 r1 F5) and the member actions (BOOK-008) the rows read. */
function ScreenProviders({ now, member, children }: { now: Date; member: BookingMemberActions; children: ReactNode }) {
  return (
    <BookingsNow.Provider value={now}>
      <BookingMemberContext.Provider value={member}>{children}</BookingMemberContext.Provider>
    </BookingsNow.Provider>
  )
}

/** BOOK-013 S5 (frame 10, AC-15): booking mode off. */
export function BookingsOff() {
  const t = useTranslations('bookings.staff')
  return (
    <section data-testid="bookings-off" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <CalendarOff aria-hidden className="size-6" />
      </span>
      <h1 className="text-xl font-semibold text-foreground">{t('offTitle')}</h1>
      <p className="text-muted-foreground">{t('offBody')}</p>
      <Button asChild variant="outline" size="lg">
        <Link href="/dashboard/setup/bookings">{t('offLink')}</Link>
      </Button>
    </section>
  )
}

export function BookingsScreen() {
  const availability = useBookingAvailability()
  if (availability === null) return <BookingsLoading />
  if (availability.mode === 'off') return <BookingsOff />
  return <BookingsOn />
}

function BookingsOn() {
  const t = useTranslations('bookings.views')
  const page = useBookingsPage()
  const { data, pendingCount, isLoading, error, refetch } = useBookings(page.range)
  const calendar = page.view === 'calendar'
  const todayView = useBookingsToday()
  const capacity = useBookingCapacity(calendar ? page.selected : null, calendar && !page.isPhone ? gridRange(page.selected) : null)
  const { reload: reloadCapacity } = capacity
  const { refetch: refetchToday } = todayView
  const refetchAll = useCallback(async () => {
    await Promise.all([refetch(), refetchToday()])
    reloadCapacity()
  }, [refetch, refetchToday, reloadCapacity])
  const staff = useStaffBooking(refetchAll)
  const rows = useBookingRowActions(refetchAll)
  const member = useBookingMemberLink(refetch)
  const now = useMinuteTick()
  const all = data?.bookings ?? []
  const prompt = <OverLimitFor rows={rows} />
  const lists = bookingsPageLists(all, { calendar, isPhone: page.isPhone, selected: page.selected, status: page.status, query: page.query })
  const actions = { busyIds: rows.busyIds, undelivered: rows.undelivered, onDecide: rows.onDecide, onNoShow: rows.onNoShow }
  const nav = calendar ? (
    <CalendarNav selected={page.selected} isPhone={page.isPhone} onShift={page.shift} onToday={page.goToday} />
  ) : (
    <TableRangeControl range={page.tableRange} onRange={page.setTableRange} />
  )

  return (
    <ScreenProviders now={now} member={member}>
      <StaffBookingContext.Provider value={staff.actions}>
      <div className="space-y-5">
        <BookingsHeader
          view={page.view} pendingCount={pendingCount} today={page.today} onView={page.setView} onShowPending={page.showPending}
          onNew={() => staff.actions.openNew(calendar ? page.selected : page.today)}
        />
        <div className={page.view === 'today' ? 'hidden' : 'flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between'}>
          {nav}
          {lists.filtersShown ? (
            <BookingsFilters
              status={page.status} counts={lists.counts} query={page.query} showSearch
              onStatus={page.setStatus} onQuery={page.setQuery}
            />
          ) : null}
        </div>
        <BookingNoticeLine notice={rows.decideNotice} />
        <NoShowNoticeLine notice={rows.noShowNotice} />
        <MemberLinkNoticeLine failed={member.failed} />
        {data?.truncated ? <p data-testid="bookings-truncated" className="text-sm text-muted-foreground">{t('truncated', { count: all.length })}</p> : null}
        {page.view === 'today' ? (
          <BookingsToday state={todayView} today={page.today} busyIds={rows.busyIds} onDecide={rows.onDecide} />
        ) : error ? (
          <LoadError onRetry={refetch} />
        ) : isLoading && !data ? (
          <BookingsLoading />
        ) : calendar ? (
          <BookingsCalendar
            bookings={lists.shown} monthEmpty={lists.scopeEmpty} dayHidden={lists.dayHidden} selected={page.selected} today={page.today}
            isPhone={page.isPhone} onSelect={page.select} {...actions}
            capacity={<DayCapacity capacity={capacity} bookings={all} date={page.selected} />} footer={prompt} badges={capacity.badges}
          />
        ) : (
          <>
            {prompt}
            <BookingsTable
            bookings={lists.shown} rangeEmpty={lists.scopeEmpty} range={page.tableRange} today={page.today}
              isPhone={page.isPhone} onRange={page.setTableRange} {...actions}
            />
          </>
        )}
      </div>
      <StaffBookingFormDialog staff={staff} />
      <CancelBookingDialog staff={staff} />
      <BookingToast toast={staff.toast} onDismiss={staff.dismissToast} />
      </StaffBookingContext.Provider>
      <MemberDetailPanel memberId={member.openMemberId} open={member.openMemberId !== null} onClose={member.closeMember} onDeleted={refetch} />
    </ScreenProviders>
  )
}
