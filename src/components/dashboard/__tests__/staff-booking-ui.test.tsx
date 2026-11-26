/**
 * BOOK-013 UI (spec UI Feedback States, test ids; mockup frames 1, 3, 7, 8):
 * the row controls in every view (⋯ Edit / Cancel, "By staff · name", the
 * check-in code, Arrived / Undo), the rules prompt, the Today rows and code
 * card, the save outcomes, and the i18n keys in both languages.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
  useLocale: () => 'en',
}))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { BookingRow } from '../booking-row'
import { BookingsTableDesktop } from '../bookings/bookings-table-desktop'
import { BookingsTableCards } from '../bookings/bookings-table-cards'
import { CalendarDayPanel } from '../bookings/calendar-day-panel'
import { RulesPrompt } from '../bookings/staff-booking-dialogs'
import { BookingsToday, CodeResultCard } from '../bookings/bookings-today'
import { BookingsNow } from '../bookings/bookings-clock'
import { StaffBookingContext, formAfter, toastFor, type FormState, type StaffBookingActions } from '../bookings/use-staff-booking'
import { canCancelBooking, canEditBooking, changedFormFields, formBody, initialForm, staffSaveOutcome, checkInOutcome } from '../bookings/staff-booking-api'
import type { BookingsTodayState } from '../bookings/use-bookings-today'
import { slotLeft } from '../bookings/staff-booking-fields'
import type { BookingItem } from '@/hooks/use-bookings'

// Thursday 2026-11-26 19:20 in Hong Kong.
const NOW = new Date('2026-11-26T11:20:00Z')
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

const booking = (over: Partial<BookingItem> = {}): BookingItem => ({
  id: 'b1', restaurantId: 'r', memberId: null, phone: '+85291234567', name: 'Mr Lam', partySize: 6, bookingDate: '2026-11-26',
  bookingTime: '19:00', notes: 'window table', status: 'confirmed', declineReason: null, decidedBy: 'u', decidedAt: null, source: 'staff',
  campaignId: null, createdAt: '2026-11-20T00:00:00Z', decisionMessageStatus: null, editVersion: 2,
  createdBy: 'u', createdByName: 'Mandy', notifyDiner: true, checkinCode: 'K7Q2MX', checkedInAt: null, ...over,
})

const actions: StaffBookingActions = {
  openNew: vi.fn(), openEdit: vi.fn(), openCancel: vi.fn(), checkIn: vi.fn(async () => {}), checkInBusy: new Set(), checkInRefused: null,
}
const noop = () => {}
const rowProps = { busyIds: new Set<string>(), undelivered: new Set<string>(), onDecide: noop }
const withStaff = (node: React.ReactNode, a: StaffBookingActions = actions) =>
  renderToStaticMarkup(<BookingsNow.Provider value={NOW}><StaffBookingContext.Provider value={a}>{node}</StaffBookingContext.Provider></BookingsNow.Provider>)

const group = (b: BookingItem) => [{ date: b.bookingDate, bookings: [b], guests: b.partySize, pending: 0 }]
const views = {
  'day list': (b: BookingItem) => withStaff(<ul><BookingRow booking={b} busy={false} undelivered={false} onDecide={noop} /></ul>),
  'desktop table': (b: BookingItem) => withStaff(<BookingsTableDesktop groups={group(b) as never} today="2026-11-26" {...rowProps} />),
  'phone cards': (b: BookingItem) => withStaff(<BookingsTableCards groups={group(b) as never} today="2026-11-26" {...rowProps} />),
}

describe.each(Object.keys(views) as Array<keyof typeof views>)('row controls in the %s', (name) => {
  const render = views[name]

  it('a staff-made confirmed booking: By staff · name, its code, the ⋯ menu and Arrived (today)', () => {
    const html = render(booking())
    expect(html).toContain('data-testid="booking-row-b1-by-staff"')
    expect(html).toContain('bookings.staff.byStaffName:{&quot;name&quot;:&quot;Mandy&quot;}')
    expect(html).toMatch(/data-testid="booking-row-b1-code"[^>]*>K7Q2MX</)
    expect(html).toContain('data-testid="booking-row-b1-menu"')
    expect(html).toContain('data-testid="booking-row-b1-arrived"')
  })

  it('an arrived booking shows Arrived HH:MM (HK) and Undo, no Arrived button', () => {
    const html = render(booking({ checkedInAt: '2026-11-26T11:04:00Z' }))
    expect(html).toContain('bookings.today.stateArrived:{&quot;time&quot;:&quot;19:04&quot;}')
    expect(html).toContain('data-testid="booking-row-b1-arrived-undo"')
    expect(html).not.toContain('data-testid="booking-row-b1-arrived"')
  })

  it('R14: no Arrived on another day, on pending or on no-show', () => {
    for (const over of [{ bookingDate: '2026-11-27' }, { status: 'pending' as const }, { status: 'no_show' as const }]) {
      expect(render(booking(over))).not.toContain('data-testid="booking-row-b1-arrived"')
    }
  })

  it('AC-10: no ⋯ menu on an original with an open change, nor on cancelled / declined rows', () => {
    const change = { id: 'c1', bookingDate: '2026-11-27', bookingTime: '20:00', partySize: 2 }
    for (const over of [{ openChange: change }, { status: 'cancelled' as const }, { status: 'declined' as const }]) {
      expect(render(booking(over as Partial<BookingItem>))).not.toContain('data-testid="booking-row-b1-menu"')
    }
  })

  it('a staff-cancelled booking says "Cancelled by staff"', () => {
    const html = render(booking({ status: 'cancelled', cancelledBy: 'staff' }))
    expect(html).toContain('data-testid="booking-row-b1-cancelled-by-staff"')
    expect(html).toContain('bookings.staff.cancelledByStaff')
  })
})

describe('menu rules (AC-10, S3)', () => {
  it('Edit on pending and confirmed; Cancel on confirmed only; neither without editVersion or with an open change', () => {
    expect([canEditBooking(booking()), canCancelBooking(booking())]).toEqual([true, true])
    expect([canEditBooking(booking({ status: 'pending' })), canCancelBooking(booking({ status: 'pending' }))]).toEqual([true, false])
    expect(canEditBooking(booking({ editVersion: undefined }))).toBe(false)
    expect(canEditBooking(booking({ editVersion: 0 }))).toBe(true)
    expect(canEditBooking(booking({ openChange: { id: 'c', bookingDate: 'x', bookingTime: 'y', partySize: 1 } as never }))).toBe(false)
  })
})

describe('slot guests left in the form (AC-8 display)', () => {
  const slot = { time: '19:00', guests: 20, limit: 20 }
  it('an edit gives the booking its own guests back in its own slot, not in others or on other days', () => {
    const own = { date: '2026-11-28', time: '19:00:00', partySize: 4 }
    expect(slotLeft(slot, '2026-11-28', own)).toBe(4)
    expect(slotLeft({ ...slot, time: '19:30' }, '2026-11-28', own)).toBe(0)
    expect(slotLeft(slot, '2026-11-29', own)).toBe(0)
  })
  it('a new booking sees the plain count; no limit is null', () => {
    expect(slotLeft(slot, '2026-11-28')).toBe(0)
    expect(slotLeft({ ...slot, limit: null }, '2026-11-28')).toBeNull()
  })
})

describe('day panel', () => {
  it('+ Add opens the form for that day', () => {
    const html = withStaff(<CalendarDayPanel date="2026-11-28" bookings={[]} monthEmpty={false} {...rowProps} />)
    expect(html).toContain('data-testid="booking-day-new-button"')
  })
})

describe('rules prompt (AC-3, frame 3)', () => {
  it('lists every broken rule with the guest numbers, and Book anyway', () => {
    const html = renderToStaticMarkup(
      <RulesPrompt
        rules={[{ code: 'slot_full', time: '19:00', guests: 18, limit: 20 }, { code: 'meal_full', period: 'Dinner', guests: 52, limit: 56 }, { code: 'outside_hours' }, { code: 'stopped', scope: 'slot' }]}
        party={6} saving={false} onBack={noop} onOverride={noop}
      />
    )
    expect(html).toContain('data-testid="booking-rules-prompt"')
    expect(html).toContain('data-testid="booking-rules-override"')
    expect(html).toContain('bookings.staff.rule.slot_full:{&quot;time&quot;:&quot;19:00&quot;}')
    expect(html).toContain('bookings.staff.rule.fullDetail:{&quot;guests&quot;:18,&quot;party&quot;:6,&quot;total&quot;:24,&quot;limit&quot;:20}')
    expect(html).toContain('bookings.staff.rule.meal_full:{&quot;period&quot;:&quot;Dinner&quot;}')
    expect(html).toContain('bookings.staff.rule.outside_hours')
    expect(html).toContain('bookings.staff.rule.stopped_slot')
  })
})

describe('Today view (S7, frames 7-8)', () => {
  const today = (bookings: BookingItem[], query = ''): BookingsTodayState => ({
    data: { date: '2026-11-26', bookings, truncated: false }, failed: false, loading: false, refetch: async () => {},
    query, setQuery: noop, codeCard: null, scan: { kind: 'closed' }, openScan: noop, scanAgain: noop, closeScan: noop, onScanned: async () => {},
  })
  const list = [
    booking({ id: 'a', bookingTime: '18:30', name: 'Wu Siu Ming', source: 'chat', checkinCode: 'ZB6N3Q' }),
    booking({ id: 'b', bookingTime: '19:30', name: 'Yeung Family', source: 'agent', checkinCode: 'T9DK2V' }),
    booking({ id: 'c', bookingTime: '13:00', name: 'Au Ka Yan', partySize: 4, checkedInAt: '2026-11-26T04:58:00Z', checkinCode: 'H2RW9C' }),
    booking({ id: 'd', bookingTime: '20:30', name: 'Kan Wai', status: 'pending', checkinCode: null }),
  ]
  const render = (state: BookingsTodayState) => withStaff(<BookingsToday state={state} today="2026-11-26" busyIds={new Set()} onDecide={noop} />)

  it('states: Late 50 min, Waiting, Arrived 12:58 with Undo, Needs reply with Confirm; counters', () => {
    const html = render(today(list))
    expect(html).toContain('data-testid="booking-row-a-arrival" data-state="late"')
    expect(html).toContain('bookings.today.stateLate:{&quot;minutes&quot;:50}')
    expect(html).toContain('data-testid="booking-row-b-arrival" data-state="waiting"')
    expect(html).toContain('bookings.today.stateArrived:{&quot;time&quot;:&quot;12:58&quot;}')
    expect(html).toContain('data-testid="booking-row-c-arrived-undo"')
    expect(html).toContain('data-testid="booking-row-d-arrival" data-state="needs_reply"')
    expect(html).toContain('data-testid="booking-row-d-confirm"')
    expect(html).toMatch(/data-testid="bookings-today-counter-arrived"[^>]*><dt[^>]*>[^<]*<\/dt><dd[^>]*>4 \/ 22</)
  })

  it('AC-20: the search narrows by name, phone digits or code; no match shows the empty state', () => {
    expect(render(today(list, 'ZB6N')).match(/data-testid="booking-row-[a-d]"/g)).toEqual(['data-testid="booking-row-a"'])
    expect(render(today(list, 'zzz'))).toContain('data-testid="bookings-today-empty"')
  })

  it('AC-21: a code card for today offers Arrived; for another day it says so and offers none', () => {
    const todayCard = withStaff(<CodeResultCard lookup={{ kind: 'found', booking: booking(), today: true }} today="2026-11-26" />)
    expect(todayCard).toContain('data-testid="booking-scan-result"')
    expect(todayCard).toContain('data-testid="booking-row-b1-arrived"')
    const other = withStaff(<CodeResultCard lookup={{ kind: 'found', booking: booking({ bookingDate: '2026-11-27' }), today: false }} today="2026-11-26" />)
    expect(other).toContain('bookings.today.codeOtherDay')
    expect(other).not.toContain('booking-row-b1-arrived')
    expect(withStaff(<CodeResultCard lookup={{ kind: 'not_found' }} today="2026-11-26" />)).toContain('data-testid="booking-scan-not-found"')
  })
})

describe('save outcomes (spec UI states)', () => {
  it('maps every answer', () => {
    expect(staffSaveOutcome(201, { booking: booking(), message: 'delivered' })).toMatchObject({ kind: 'saved', message: 'delivered' })
    expect(staffSaveOutcome(400, { error: 'invalid', fields: { phone: 'invalid' } })).toEqual({ kind: 'invalid', fields: { phone: 'invalid' } })
    expect(staffSaveOutcome(409, { error: 'rules', rules: [{ code: 'too_soon' }] })).toEqual({ kind: 'rules', rules: [{ code: 'too_soon' }] })
    expect(staffSaveOutcome(409, { error: 'changed', status: 'cancelled' })).toEqual({ kind: 'stale' })
    expect(staffSaveOutcome(409, { error: 'open_change' })).toEqual({ kind: 'open_change' })
    expect(staffSaveOutcome(409, { error: 'booking_off' })).toEqual({ kind: 'booking_off' })
    expect(staffSaveOutcome(500, {})).toEqual({ kind: 'error' })
    expect(checkInOutcome(409, { error: 'not_today' })).toEqual({ kind: 'refused', reason: 'not_today' })
  })

  it('the form: rules open the prompt, stale shows the banner, invalid shows field errors, saved closes', () => {
    const form: FormState = { mode: 'new', booking: null, values: initialForm('2026-11-28'), errors: {}, rules: null, stale: null, saving: true }
    expect(formAfter(form, { kind: 'rules', rules: [{ code: 'too_far' }] })).toMatchObject({ rules: [{ code: 'too_far' }], saving: false })
    expect(formAfter(form, { kind: 'stale' })).toMatchObject({ stale: 'changed' })
    expect(formAfter(form, { kind: 'open_change' })).toMatchObject({ stale: 'open_change' })
    expect(formAfter(form, { kind: 'invalid', fields: { name: 'required' } })).toMatchObject({ errors: { name: 'required' } })
    expect(formAfter(form, { kind: 'saved', booking: booking(), message: 'none' })).toBeNull()
  })

  it('the toast says when WhatsApp was not delivered or skipped', () => {
    expect(toastFor('added', 'delivered')).toBe('added')
    expect(toastFor('added', 'none')).toBe('added')
    expect(toastFor('updated', 'not_delivered')).toBe('not_delivered')
    expect(toastFor('cancelled', 'throttled')).toBe('throttled')
  })

  it('R4: the body carries only the form fields; edit marks the changed ones', () => {
    const b = booking()
    const values = { ...initialForm(b.bookingDate, b), partySize: 4, time: '19:30' }
    expect(formBody(values, { expectedVersion: b.editVersion })).toMatchObject({ expectedVersion: 2 })
    expect(Object.keys(formBody(values, { expectedVersion: b.editVersion }))).toEqual(['phone', 'name', 'partySize', 'date', 'time', 'notes', 'notify', 'expectedVersion'])
    expect([...changedFormFields(b, values)]).toEqual(['partySize', 'time'])
    expect(initialForm('2026-11-28')).toMatchObject({ date: '2026-11-28', notify: true, partySize: 2 })
  })
})

describe('i18n (en + zh-HK)', () => {
  const keysOf = (o: Record<string, unknown>, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]))
  it('every BOOK-013 key exists in both languages', () => {
    const pick = (m: typeof en) => ({ staff: m.bookings.staff, today: m.bookings.today })
    expect(keysOf(pick(zhHK as typeof en)).sort()).toEqual(keysOf(pick(en)).sort())
    for (const m of [en, zhHK]) {
      expect(m.bookings.views.today).toBeTruthy()
      expect(m.bookings.views.source.staff).toBeTruthy()
      expect(m.bookings.noShowCheckedIn).toBeTruthy()
      expect(m.bookingSettings.templates.kind.changed).toBeTruthy()
      expect(m.bookingSettings.templates.kind.cancelled).toBeTruthy()
    }
  })
})
