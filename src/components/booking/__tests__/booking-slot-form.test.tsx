// BOOK-009 W3 (spec S2: AC-5, AC-6, AC-7, AC-9; D3 sent summary): the diner booking page with booking hours.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/hooks/use-booking-slot-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-booking-slot-form')>()
  return { ...actual, useBookingSlotForm: vi.fn(actual.useBookingSlotForm) }
})

import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import { checkSlot, slotsFor } from '@/domain/services/booking-hours'
import { dayState, groupSlots, missingStep, monthGrid, monthsInWindow, timesChanged } from '../slot-picker-model'
import { DayCalendar } from '../day-calendar'
import { SlotList, TableTime } from '../slot-list'
import { SummaryBar } from '../summary-bar'
import { TermsBlock } from '../terms-block'
import { SlotBookingSent } from '../slot-booking-sent'
import { BookingSlotForm } from '../booking-slot-form'
import { BookingPageView, type BookingPageViewModel } from '../booking-page-view'
import { EMPTY_SLOT_FORM, sendSlotForm, useBookingSlotForm, type SlotFormValues } from '@/hooks/use-booking-slot-form'

const LUNCH = { label: '午市', first: '12:00', last: '14:00' }
const DINNER = { label: '晚市', first: '18:00', last: '21:30' }
const OPEN = [LUNCH, DINNER]
// Today Fri 2026-11-20, 10:00 HK; Mon closed; 2026-11-24 (Tue) special closed; 30 days ahead → 2026-12-20.
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: [], tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN, sun: OPEN },
  special: [{ date: '2026-11-24', label: '休假', periods: [] }],
  tableMinutes: 120,
  terms: { zh_hk: '逾時 15 分鐘，座位可能讓給其他客人。', en: 'Tables are held for 15 minutes.' },
  info: { address: '銅鑼灣示範街 1 號', phone: '2345 6789', mapUrl: 'https://maps.example/x' },
}
const CLOCK = { today: '2026-11-20', nowTime: '10:00' }
const FULL: SlotFormValues = { partySize: 2, date: '2026-11-21', time: '19:00', name: '陳大文', notes: 'BB 櫈', accepted: true }

const formView = (schedule?: { hours: BookingHours; nowTime: string }): BookingPageViewModel => ({
  kind: 'form',
  restaurant: { name: 'Demo Bistro', logoUrl: null },
  maskedPhone: '•••• 4567',
  maxPartySize: 8,
  today: CLOCK.today,
  retryUrl: 'https://wa.me/85220000001?text=BOOK',
  ...(schedule ? { schedule } : {}),
})

describe('slot picker model (AC-6)', () => {
  it('day states: past, closed weekday, closed special date, beyond the window, no slot left, open', () => {
    expect(dayState(HOURS, '2026-11-19', CLOCK)).toBe('past')
    expect(dayState(HOURS, '2026-11-23', CLOCK)).toBe('closed')
    expect(dayState(HOURS, '2026-11-24', CLOCK)).toBe('closed')
    expect(dayState(HOURS, '2026-12-21', CLOCK)).toBe('beyond')
    expect(dayState(HOURS, '2026-11-20', { ...CLOCK, nowTime: '20:00' })).toBe('full')
    expect(dayState(HOURS, '2026-11-21', CLOCK)).toBe('open')
  })

  it('every open day and slot the page offers is one the server check accepts (shared slotsFor)', () => {
    for (const date of ['2026-11-20', '2026-11-21', '2026-12-20']) {
      for (const s of slotsFor(HOURS, date, CLOCK)) expect(checkSlot(HOURS, date, s.time, CLOCK)).toBeNull()
    }
  })

  it('months from today to the window end; a Sunday-first grid of whole weeks', () => {
    expect(monthsInWindow(HOURS, CLOCK.today)).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 12 }])
    const grid = monthGrid({ year: 2026, month: 11 })
    expect(grid.every((w) => w.length === 7)).toBe(true)
    expect(grid.flat().filter(Boolean)).toHaveLength(30)
    expect(grid[0][0]).toBe('2026-11-01') // 1 Nov 2026 is a Sunday
  })

  it('groups by period label; unlabelled slots as lunch < 15:00, afternoon 15–17, evening ≥ 17', () => {
    const labelled = groupSlots(slotsFor(HOURS, '2026-11-21', CLOCK))
    expect(labelled.map((g) => [g.label, g.slots[0].time, g.slots.at(-1)!.time])).toEqual([['午市', '12:00', '14:00'], ['晚市', '18:00', '21:30']])
    const plain = groupSlots(['12:30', '14:30', '15:00', '16:30', '17:00', '20:00'].map((time) => ({ time, label: null })))
    expect(plain.map((g) => [g.fallback, g.slots.map((s) => s.time)])).toEqual([
      ['lunch', ['12:30', '14:30']], ['afternoon', ['15:00', '16:30']], ['evening', ['17:00', '20:00']],
    ])
  })

  it('AC-7: the first missing step in order party → day → slot → terms', () => {
    const base = { partySize: 2, date: '2026-11-21', time: '19:00', termsRequired: true, accepted: true }
    expect(missingStep({ ...base, partySize: null, date: '' })).toBe('party')
    expect(missingStep({ ...base, date: '' })).toBe('date')
    expect(missingStep({ ...base, time: '' })).toBe('time')
    expect(missingStep({ ...base, accepted: false })).toBe('terms')
    expect(missingStep({ ...base, termsRequired: false, accepted: false })).toBeNull()
    expect(missingStep(base)).toBeNull()
  })
})

describe('calendar and slots render (AC-6)', () => {
  const calendar = (value = '') => renderToStaticMarkup(<DayCalendar hours={HOURS} clock={CLOCK} value={value} onChange={() => {}} />)

  it('a closed day is greyed, marked 休息 and not selectable; a past day is not a button', () => {
    const html = calendar()
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-disabled="true"[^>]*data-testid="booking-day-2026-11-23" data-state="closed"/)
    expect(html).toMatch(/data-testid="booking-day-2026-11-24" data-state="closed"[^>]*>.*?booking\.picker\.closed/)
    expect(html).toMatch(/<span data-testid="booking-day-2026-11-19" data-state="past"/)
    expect(html).toMatch(/<button[^>]*aria-disabled="false"[^>]*data-testid="booking-day-2026-11-21" data-state="open"/)
    expect(html).toContain('booking.picker.today')
    expect(html).toMatch(/disabled=""[^>]*data-testid="booking-calendar-prev"/)
  })

  it('the chosen day is pressed', () => {
    expect(calendar('2026-11-21')).toMatch(/aria-pressed="true" data-testid="booking-day-2026-11-21"/)
  })

  it('slots are buttons grouped by period label with test ids booking-slot-HHMM, then the table time', () => {
    const html = renderToStaticMarkup(<SlotList hours={HOURS} clock={CLOCK} date="2026-11-21" value="19:00" onChange={() => {}} />)
    expect(html).toContain('aria-label="午市"')
    expect(html).toContain('aria-label="晚市"')
    expect(html).toMatch(/aria-pressed="true" data-testid="booking-slot-1900"/)
    expect(html).toContain('data-testid="booking-slot-1200"')
    expect(html).not.toContain('booking-slot-1430')
    expect(html.indexOf('booking-slot-1400')).toBeLessThan(html.indexOf('aria-label="晚市"'))
    expect(renderToStaticMarkup(<TableTime minutes={120} />)).toContain('data-testid="booking-table-time"')
    expect(renderToStaticMarkup(<TableTime minutes={null} />)).toBe('')
  })

  it('no day yet → the pick-a-day line; a day with no slot left → its own line', () => {
    expect(renderToStaticMarkup(<SlotList hours={HOURS} clock={CLOCK} date="" value="" onChange={() => {}} />)).toContain('booking.picker.pickDayFirst')
    expect(renderToStaticMarkup(<SlotList hours={HOURS} clock={{ ...CLOCK, nowTime: '20:00' }} date="2026-11-20" value="" onChange={() => {}} />))
      .toContain('data-testid="booking-no-slots"')
  })
})

describe('summary bar and submit (AC-7)', () => {
  const bar = (values: SlotFormValues, missing: Parameters<typeof SummaryBar>[0]['missing'], preview = false) =>
    renderToStaticMarkup(<SummaryBar values={values} missing={missing} submitting={false} preview={preview} />)

  it('incomplete: submit disabled and labelled with the missing step', () => {
    const html = bar({ ...FULL, time: '' }, 'time')
    expect(html).toContain('data-testid="booking-summary-bar"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="booking-submit"[^>]*>booking\.picker\.missing\.time</)
  })

  it('complete: chips show party, day and time and submit is enabled', () => {
    const html = bar(FULL, null)
    expect(html).toContain('booking.picker.partyChip:{&quot;n&quot;:2}')
    expect(html).toContain('booking.picker.dayLabel:{&quot;month&quot;:&quot;booking.picker.monthsShort.11&quot;,&quot;day&quot;:21,&quot;weekday&quot;:&quot;booking.picker.weekdays.sat&quot;}')
    expect(html).toContain('>19:00<')
    expect(html).not.toMatch(/disabled=""[^>]*data-testid="booking-submit"/)
    expect(html).toMatch(/data-testid="booking-submit"[^>]*>booking\.submit</)
  })

  it('preview keeps submit disabled even when complete', () => {
    expect(bar(FULL, null, true)).toMatch(/disabled=""[^>]*data-testid="booking-submit"/)
  })

  it('the bar sits fixed at the bottom of the screen', () => {
    expect(bar(FULL, null)).toMatch(/data-testid="booking-summary-bar" class="fixed inset-x-0 bottom-0/)
  })
})

describe('terms (AC-6) and sent summary (D3)', () => {
  it('shows both set languages as text with a required tick', () => {
    const html = renderToStaticMarkup(<TermsBlock terms={{ zh_hk: '<b>x</b>', en: 'Tables 15 min' }} accepted={false} onChange={() => {}} />)
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('lang="zh-HK"')
    expect(html).toContain('Tables 15 min')
    expect(html).toContain('data-testid="booking-terms-tick"')
  })

  it('sent: title, date, time, party, name and "Terms accepted" only when ticked', () => {
    const html = renderToStaticMarkup(<SlotBookingSent values={FULL} termsAccepted />)
    expect(html).toContain('booking.sentTitle')
    expect(html).toContain('booking.sentBody')
    expect(html).toContain('陳大文')
    expect(html).toContain('>19:00<')
    expect(html).toContain('data-testid="booking-sent-terms"')
    expect(renderToStaticMarkup(<SlotBookingSent values={FULL} termsAccepted={false} />)).not.toContain('booking-sent-terms')
  })
})

describe('times changed (AC-9)', () => {
  it('a time/date refusal clears only the time, keeps party, day, name and notes, and names the time; acceptTerms is sent', async () => {
    const post = vi.fn(async () => ({ kind: 'fields' as const, errors: { time: 'outside_hours' } }))
    const step = await sendSlotForm('tok', FULL, true, post)
    expect(post).toHaveBeenCalledWith('tok', { date: '2026-11-21', time: '19:00', partySize: '2', name: '陳大文', notes: 'BB 櫈' }, { acceptTerms: true })
    expect(step.values).toEqual({ ...FULL, time: '' })
    expect(step.changedTime).toBe('19:00')
  })

  it.each(['closed_day', 'too_far', 'past'])('date code %s also counts as times changed', (code) => {
    expect(timesChanged({ date: code })).toBe(true)
  })

  it('other refusals are not times changed and leave the form as it was; no terms → no acceptTerms field', async () => {
    const post = vi.fn(async () => ({ kind: 'fields' as const, errors: { name: 'required' } }))
    const step = await sendSlotForm('tok', FULL, false, post)
    expect(post.mock.calls[0]).toHaveLength(3)
    expect((post.mock.calls[0] as unknown[])[2]).toEqual({})
    expect(step).toMatchObject({ values: FULL, changedTime: null })
    expect(timesChanged({ acceptTerms: 'terms_required' })).toBe(false)
  })

  it('renders the booking-times-changed notice with the kept values', () => {
    vi.mocked(useBookingSlotForm).mockImplementationOnce(() => ({
      values: { ...FULL, time: '' }, set: () => {}, submitting: false, missing: 'time', submit: async () => {},
      outcome: { kind: 'fields', errors: { time: 'outside_hours' } }, changedTime: '19:00',
    }))
    const html = renderToStaticMarkup(
      <BookingSlotForm token="t" maskedPhone="•••• 4567" maxPartySize={8} retryUrl={null} today={CLOCK.today} schedule={{ hours: HOURS, nowTime: '10:00' }} />
    )
    expect(html).toContain('data-testid="booking-times-changed"')
    expect(html).toContain('booking.picker.timesChangedBody:{&quot;time&quot;:&quot;19:00&quot;}')
    expect(html).toMatch(/aria-checked="true" data-testid="booking-party-2"/)
    expect(html).toContain('value="陳大文"')
    expect(html).toContain('BB 櫈')
  })
})

describe('booking page with and without hours (AC-5, AC-6)', () => {
  it('AC-5: no hours → the BOOK-001 date/time form, no slot picker, no info block', () => {
    const html = renderToStaticMarkup(<BookingPageView view={formView()} token="t" />)
    expect(html).toContain('data-testid="booking-date-input"')
    expect(html).toContain('data-testid="booking-time-input"')
    expect(html).not.toContain('booking-summary-bar')
    expect(html).not.toContain('booking-restaurant-info')
    expect(html).not.toContain('booking-terms')
  })

  it('AC-6: hours set → info, party chips 1..max, calendar, terms, collection statement, summary bar, in that order', () => {
    const html = renderToStaticMarkup(<BookingPageView view={formView({ hours: HOURS, nowTime: '10:00' })} token="t" />)
    const order = ['booking-restaurant-name', 'booking-restaurant-info', 'booking-party-1', 'booking-party-8', 'booking-large-party',
      'booking-calendar', 'booking-table-time', 'booking-name-input', 'booking-notes-input', 'booking-terms-tick', 'booking-summary-bar',
      'booking-collection-statement'].map((id) => html.indexOf(`data-testid="${id}"`))
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).not.toContain('booking-party-9')
    expect(html).not.toContain('data-testid="booking-date-input"')
    expect(html).toContain('href="tel:23456789"')
    expect(html).toContain('href="https://wa.me/85220000001?text=BOOK"')
    expect(html).toContain('booking.picker.notesPlaceholder')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="booking-submit"[^>]*>booking\.picker\.missing\.party</)
    expect(html).not.toMatch(/<script/i)
  })

  it('no terms set → no terms block or tick', () => {
    const html = renderToStaticMarkup(<BookingPageView view={formView({ hours: { ...HOURS, terms: { zh_hk: '', en: '' } }, nowTime: '10:00' })} token="t" />)
    expect(html).not.toContain('booking-terms-tick')
  })

  it('preview: the banner, no <main> landmark of its own, submit disabled', () => {
    const html = renderToStaticMarkup(<BookingPageView view={formView({ hours: HOURS, nowTime: '10:00' })} token="" preview />)
    expect(html).toContain('data-testid="booking-preview-banner"')
    expect(html).not.toContain('<main')
    expect(html).toMatch(/disabled=""[^>]*data-testid="booking-submit"/)
    const legacy = renderToStaticMarkup(<BookingPageView view={formView()} token="" preview />)
    expect(legacy).toMatch(/disabled=""[^>]*data-testid="booking-submit"/)
  })

  it('EMPTY_SLOT_FORM starts with nothing chosen', () => {
    expect(EMPTY_SLOT_FORM).toEqual({ partySize: null, date: '', time: '', name: '', notes: '', accepted: false })
  })
})
