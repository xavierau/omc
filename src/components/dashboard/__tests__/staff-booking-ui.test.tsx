/**
 * BOOK-013 UI (spec UI Feedback States, test ids; mockup frames 1, 3, 7, 8):
 * the row controls in every view (⋯ Edit / Cancel, "By staff · name",
 * Arrived / Undo; no check-in code: decision 8), the rules prompt, the Today
 * view (search, sort AC-25), the save outcomes, and the i18n keys in both
 * languages.
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
import { BookingsToday } from '../bookings/bookings-today'
import { BookingsNow } from '../bookings/bookings-clock'
import { StaffBookingContext, formAfter, toastFor, type FormState, type StaffBookingActions } from '../bookings/use-staff-booking'
import { canCancelBooking, canEditBooking, changedFormFields, formBody, initialForm, staffSaveOutcome, checkInOutcome } from '../bookings/staff-booking-api'
import type { BookingsTodayState } from '../bookings/use-bookings-today'
import { slotLeft, StaffBookingFields } from '../bookings/staff-booking-fields'
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
  createdBy: 'u', createdByName: 'Mandy', notifyDiner: true, checkedInAt: null, ...over,
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

  it('a staff-made confirmed booking: By staff · name, the ⋯ menu and Arrived (today); no check-in code', () => {
    const html = render(booking())
    expect(html).toContain('data-testid="booking-row-b1-by-staff"')
    expect(html).toContain('bookings.staff.byStaffName:{&quot;name&quot;:&quot;Mandy&quot;}')
    expect(html).not.toContain('booking-row-b1-code')
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

describe('Today view (S7, AC-20, AC-25; frames 7-8)', () => {
  const today = (bookings: BookingItem[], query = ''): BookingsTodayState => ({
    data: { date: '2026-11-26', bookings, truncated: false }, failed: false, loading: false, refetch: async () => {}, query, setQuery: noop,
  })
  const list = [
    booking({ id: 'a', bookingTime: '18:30', name: 'Wu Siu Ming', source: 'chat', partySize: 2 }),
    booking({ id: 'b', bookingTime: '19:30', name: 'Yeung Family', source: 'agent', partySize: 8 }),
    booking({ id: 'c', bookingTime: '13:00', name: 'Au Ka Yan', partySize: 4, checkedInAt: '2026-11-26T04:58:00Z' }),
    booking({ id: 'd', bookingTime: '20:30', name: 'Chan Ka Wai', status: 'pending', partySize: 4 }),
  ]
  type Sort = { key: 'time' | 'name' | 'guests' | 'status'; dir: 'asc' | 'desc' }
  const render = (state: BookingsTodayState, sort: Sort = { key: 'time', dir: 'asc' }, isPhone = false) =>
    withStaff(<BookingsToday state={state} sort={sort} onSort={noop} onSortChange={noop} isPhone={isPhone} busyIds={new Set()} onDecide={noop} />)
  const order = (html: string) => (html.match(/data-testid="booking-row-[a-d]"/g) ?? []).map((m) => m.slice(-2, -1))

  it('states: Late 50 min, Waiting, Arrived 12:58 with Undo, Needs reply with Confirm; counters', () => {
    const html = render(today(list))
    expect(html).toContain('data-testid="booking-row-a-arrival" data-state="late"')
    expect(html).toContain('bookings.today.stateLate:{&quot;minutes&quot;:50}')
    expect(html).toContain('data-testid="booking-row-b-arrival" data-state="waiting"')
    expect(html).toContain('bookings.today.stateArrived:{&quot;time&quot;:&quot;12:58&quot;}')
    expect(html).toContain('data-testid="booking-row-c-arrived-undo"')
    expect(html).toContain('data-testid="booking-row-d-arrival" data-state="needs_reply"')
    expect(html).toContain('data-testid="booking-row-d-confirm"')
    expect(html).toMatch(/data-testid="bookings-today-counter-arrived"[^>]*><dt[^>]*>[^<]*<\/dt><dd[^>]*>4 \/ 18</)
  })

  it('decision 8: no Scan button, no code card, no code on the rows', () => {
    for (const html of [render(today(list)), render(today(list), undefined, true)]) {
      expect(html).not.toMatch(/-scan\b|-scan-|row-[a-d]-code/)
    }
  })

  it('AC-20: the search narrows by name or phone digits; a code-shaped query matches nothing; no match shows the empty state', () => {
    expect(order(render(today(list, 'Wu')))).toEqual(['a'])
    expect(order(render(today(list, 'K7Q2MX')))).toEqual([])
    expect(render(today(list, 'zzz'))).toContain('data-testid="bookings-today-empty"')
  })

  it('AC-25 desktop: a header row of columnheaders, buttons for Time / Name / Guests / Status, aria-sort only on the active one, Action not sortable', () => {
    const html = render(today(list), { key: 'name', dir: 'desc' })
    expect(html).toContain('role="table"')
    expect(html.match(/role="columnheader"/g)).toHaveLength(5)
    expect(html.match(/aria-sort="/g)).toEqual(['aria-sort="'])
    expect(html).toMatch(/role="columnheader" aria-sort="descending"><button[^>]*data-testid="bookings-today-sort-name"/)
    for (const key of ['time', 'name', 'guests', 'status']) expect(html).toContain(`data-testid="bookings-today-sort-${key}"`)
    expect(html).toMatch(/role="columnheader"[^>]*>bookings\.today\.sort\.action</)
    expect(html).not.toContain('data-testid="bookings-today-sort"')
  })

  it('AC-25: Time sort shows Lunch / Dinner headings in order; any other sort shows none', () => {
    const byTime = render(today(list))
    expect(order(byTime)).toEqual(['c', 'a', 'b', 'd'])
    expect(byTime.indexOf('bookings-today-group-lunch')).toBeLessThan(byTime.indexOf('booking-row-c"'))
    expect(byTime.indexOf('bookings-today-group-dinner')).toBeGreaterThan(byTime.indexOf('booking-row-c"'))
    expect(byTime.indexOf('bookings-today-group-dinner')).toBeLessThan(byTime.indexOf('booking-row-a"'))
    expect(byTime).toMatch(/role="columnheader" aria-sort="ascending"><button[^>]*data-testid="bookings-today-sort-time"/)
    const byName = render(today(list), { key: 'name', dir: 'asc' })
    expect(order(byName)).toEqual(['c', 'd', 'a', 'b'])
    expect(byName).not.toContain('bookings-today-group-')
  })

  it('AC-25: guests largest first, status Late → Waiting → Needs reply → Arrived, both kept with a search', () => {
    expect(order(render(today(list), { key: 'guests', dir: 'desc' }))).toEqual(['b', 'c', 'd', 'a'])
    expect(order(render(today(list), { key: 'status', dir: 'asc' }))).toEqual(['a', 'b', 'd', 'c'])
    expect(order(render(today(list, 'a'), { key: 'name', dir: 'desc' }))).toEqual(['b', 'd', 'c'])
    expect(order(render(today(list, 'Ka'), { key: 'time', dir: 'desc' }))).toEqual(['d', 'c'])
  })

  it('AC-25 phone: the Sort select (no column headers) with the active choice selected, cards in sort order', () => {
    const html = render(today(list), { key: 'guests', dir: 'asc' }, true)
    expect(html).toContain('data-testid="bookings-today-sort"')
    expect(html).toMatch(/<option value="guests:asc" selected="">bookings\.today\.sort\.option\.guests_asc<\/option>/)
    expect(html.match(/<option /g)).toHaveLength(8)
    expect(html).not.toContain('role="columnheader"')
    expect(order(html)).toEqual(['a', 'c', 'd', 'b'])
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

/** Spec decision 9 / S8 (AC-26–AC-28): a staff booking without a phone. */
describe('S8 — no phone (decision 9)', () => {
  const none = booking({ phone: null, notifyDiner: false, name: 'Walk-in Ho' })
  const shown = (html: string) => {
    expect(html).toContain('bookings.staff.noPhone')
    expect(html).not.toContain('href="tel:')
    expect(html).not.toContain('>null<')
  }

  it.each(Object.keys(views) as Array<keyof typeof views>)('AC-27: the %s shows "No phone" where the number goes, no tel: link', (name) => {
    shown(views[name](none))
  })

  it('AC-27: the Calendar day panel row shows "No phone"', () => {
    shown(withStaff(<CalendarDayPanel date="2026-11-26" bookings={[none]} monthEmpty={false} {...rowProps} />))
  })

  it('AC-27: Today desktop row and phone card show "No phone"; a phone search skips it, a name search finds it', () => {
    const state = (query = ''): BookingsTodayState => ({
      data: { date: '2026-11-26', bookings: [none], truncated: false }, failed: false, loading: false, refetch: async () => {}, query, setQuery: noop,
    })
    const render = (q: string, isPhone: boolean) =>
      withStaff(<BookingsToday state={state(q)} sort={{ key: 'time', dir: 'asc' }} onSort={noop} onSortChange={noop} isPhone={isPhone} busyIds={new Set()} onDecide={noop} />)
    for (const isPhone of [false, true]) {
      shown(render('', isPhone))
      expect(render('ho', isPhone)).toContain('data-testid="booking-row-b1"')
      expect(render('9123 4567', isPhone)).toContain('data-testid="bookings-today-empty"')
    }
  })

  const fields = (values: ReturnType<typeof initialForm>, mode: 'new' | 'edit' = 'new', phoneOptional = true) =>
    renderToStaticMarkup(<StaffBookingFields mode={mode} values={values} errors={{}} changed={new Set()} phoneOptional={phoneOptional} onChange={noop} />)
  const notifyInput = (html: string) => html.match(/<input[^>]*data-testid="booking-form-notify"[^>]*>/)?.[0] ?? ''

  it('AC-26: an empty phone → the label says optional, Notify unticked and disabled with the no-phone hint', () => {
    const html = fields({ ...initialForm('2026-11-28'), notify: true })
    expect(html).toContain('bookings.staff.phoneOptional')
    expect(notifyInput(html)).toContain('disabled=""')
    expect(notifyInput(html)).not.toContain('checked=""')
    expect(html).toContain('bookings.staff.notifyNoPhone')
    expect(html).not.toContain('bookings.staff.notifyCreateHint')
  })

  it('AC-28: with a phone, Notify is available and keeps its value; the usual hint shows', () => {
    const html = fields({ ...initialForm('2026-11-28'), phone: '9123 4567' })
    expect(notifyInput(html)).not.toContain('disabled=""')
    expect(notifyInput(html)).toContain('checked=""')
    expect(html).toContain('bookings.staff.notifyCreateHint')
  })

  it('R20: editing a diner-channel booking keeps the plain (required) phone label', () => {
    expect(fields(initialForm('2026-11-28', booking({ source: 'chat' })), 'edit', false)).not.toContain('bookings.staff.phoneOptional')
  })

  it('AC-26 / AC-28: the body sends Notify off without a phone; editing a phone-less booking starts with Notify ticked for when a phone is added', () => {
    expect(formBody({ ...initialForm('2026-11-28'), phone: '  ', notify: true })).toMatchObject({ phone: '', notify: false })
    expect(formBody({ ...initialForm('2026-11-28'), phone: '9123 4567', notify: true })).toMatchObject({ notify: true })
    expect(initialForm('2026-11-26', none)).toMatchObject({ phone: '', notify: true })
    expect([...changedFormFields(none, initialForm('2026-11-26', none))]).toEqual([])
  })

  it('R20: a 400 phone_required shows on the phone field', () => {
    expect(staffSaveOutcome(400, { error: 'phone_required', fields: { phone: 'required' } })).toEqual({ kind: 'invalid', fields: { phone: 'required' } })
  })

  it('copy: the exact en and zh-HK strings', () => {
    expect([en.bookings.staff.noPhone, en.bookings.staff.notifyNoPhone]).toEqual(['No phone', 'No phone, no WhatsApp message'])
    expect([zhHK.bookings.staff.noPhone, zhHK.bookings.staff.notifyNoPhone]).toEqual(['未有電話', '沒有電話，不會發送 WhatsApp'])
    expect(en.bookings.staff.phoneOptional).toBeTruthy()
    expect(zhHK.bookings.staff.phoneOptional).toBeTruthy()
  })
})
