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
 */
import { useCallback, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
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

export function BookingsScreen() {
  const t = useTranslations('bookings.views')
  const page = useBookingsPage()
  const { data, pendingCount, isLoading, error, refetch } = useBookings(page.range)
  const calendar = page.view === 'calendar'
  const capacity = useBookingCapacity(calendar ? page.selected : null, calendar && !page.isPhone ? gridRange(page.selected) : null)
  const { reload: reloadCapacity } = capacity
  const refetchAll = useCallback(async () => {
    await refetch()
    reloadCapacity()
  }, [refetch, reloadCapacity])
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
      <div className="space-y-5">
        <BookingsHeader view={page.view} pendingCount={pendingCount} onView={page.setView} onShowPending={page.showPending} />
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
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
        {error ? (
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
      <MemberDetailPanel memberId={member.openMemberId} open={member.openMemberId !== null} onClose={member.closeMember} onDeleted={refetch} />
    </ScreenProviders>
  )
}
