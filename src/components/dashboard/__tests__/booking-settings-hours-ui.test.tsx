// BOOK-009 W2 (spec S1, AC-1..AC-3, AC-5, UI Feedback States): the Settings → Booking hours blocks.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}))
const summaryState = vi.hoisted(() => ({ value: { loading: false, summary: null as unknown } }))
vi.mock('@/hooks/use-booking-availability', () => ({
  useBookingSettingsSummaryState: () => summaryState.value,
  parseTemplateStatuses: () => null,
}))
vi.mock('@/hooks/use-booking-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-booking-settings')>()
  return { ...actual, useBookingSettings: vi.fn(actual.useBookingSettings) }
})
vi.mock('@/hooks/use-booking-template-overview', () => ({
  useBookingTemplateOverview: () => ({ templates: null, editor: null, editingKind: null, toggle: () => {}, close: () => {}, onSaved: () => {} }),
}))

import { BookingSettingsSection } from '../booking-settings-section'
import { hasUnsavedChanges, toForm, toPayload, useBookingSettings } from '@/hooks/use-booking-settings'
import { DEFAULT_BOOKING_CONFIG, parseBookingSettings, type BookingConfig } from '@/domain/value-objects/booking-config'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import { addSpecial, copyDay, noBookableTimes, setDayOpen } from '../booking-settings/hours-model'
import { dayError, errorCount, specialError } from '../booking-settings/hours-errors'

const LUNCH = { label: '午市', first: '12:00', last: '14:00' }
const DINNER = { label: '晚市', first: '18:00', last: '21:30' }
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: [], tue: [LUNCH, DINNER], wed: [LUNCH, DINNER], thu: [LUNCH, DINNER], fri: [LUNCH, DINNER], sat: [LUNCH, DINNER], sun: [LUNCH, DINNER] },
  special: [{ date: '2026-12-25', label: '聖誕', periods: [] }],
  tableMinutes: 120,
  terms: { zh_hk: '逾時 15 分鐘', en: '' },
  info: { address: '銅鑼灣', phone: '2345 6789', mapUrl: 'https://maps.example/x' },
}
const simple = (patch: Partial<BookingConfig> = {}): BookingConfig => ({ ...DEFAULT_BOOKING_CONFIG, mode: 'simple', ...patch })
const render = (config: BookingConfig) => renderToStaticMarkup(<BookingSettingsSection initialConfig={config} />)

function withOutcome(config: BookingConfig, errors: Record<string, string>) {
  vi.mocked(useBookingSettings).mockImplementationOnce(() => ({
    form: toForm(config), update: () => {}, save: async () => {}, saving: false,
    outcome: { kind: 'fields', errors },
  }))
  return render(config)
}

describe('BOOK-009 settings blocks render (S1)', () => {
  it('Simple mode shows the blocks in spec order, before the relabelled notes textarea', () => {
    const html = render(simple({ bookingHours: HOURS }))
    const order = [
      'booking-settings-hours-mon', 'booking-settings-hours-sun', 'booking-settings-interval', 'booking-settings-notice',
      'booking-settings-ahead', 'booking-settings-special-add', 'booking-settings-max-party', 'booking-settings-table-time',
      'booking-settings-terms-zh_hk', 'booking-settings-terms-en', 'booking-settings-info-address', 'booking-settings-info-phone',
      'booking-settings-info-map', 'booking-settings-preview', 'booking-settings-summary', 'booking-settings-rules',
    ].map((id) => html.indexOf(`data-testid="${id}"`))
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('bookingSettings.bookingRules')
  })

  it.each(['off', 'external'] as const)('mode %s renders no hours blocks', (mode) => {
    const html = render({ ...DEFAULT_BOOKING_CONFIG, mode, externalUrl: 'https://x.example', bookingHours: HOURS })
    expect(html).not.toContain('booking-settings-hours')
    expect(html).not.toContain('booking-settings-preview')
  })

  it('shows stored values: closed Monday, labelled periods, interval, table time, terms counter, info', () => {
    const html = render(simple({ bookingHours: HOURS }))
    expect(html).toMatch(/data-testid="booking-settings-hours-mon" data-open="false"/)
    expect(html).toMatch(/data-testid="booking-settings-hours-tue" data-open="true"/)
    expect(html).toContain('value="午市"')
    expect(html).toContain('value="21:30"')
    expect(html).toMatch(/data-testid="booking-settings-interval-30"[^>]*|aria-checked="true"[^>]*data-testid="booking-settings-interval-30"/)
    expect(html).toMatch(/aria-checked="true" data-testid="booking-settings-table-time-120"/)
    expect(html).toContain('bookingSettings.bookingHours.counter:{&quot;count&quot;:8,&quot;max&quot;:1000}')
    expect(html).toContain('value="https://maps.example/x"')
    expect(html).toContain('data-testid="booking-settings-special-0"')
    expect(html).toContain('value="2026-12-25"')
  })

  it('AC-5: hours not set → an all-closed table with the not-configured hint, no warning', () => {
    const html = render(simple())
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) expect(html).toContain(`data-testid="booking-settings-hours-${day}" data-open="false"`)
    expect(html).toContain('data-testid="booking-settings-hours-not-set"')
    expect(html).not.toContain('booking-settings-hours-warning')
  })

  it('every day closed once hours are set: the "cannot pick any time" warning (save still allowed)', () => {
    const html = render(simple({ bookingHours: { ...EMPTY_BOOKING_HOURS, terms: { zh_hk: 'x', en: '' } } }))
    expect(html).toContain('data-testid="booking-settings-hours-warning"')
    expect(html).not.toMatch(/data-testid="booking-settings-save"[^>]*disabled/)
  })

  it('the party max shows the large-party line diners see', () => {
    const html = render(simple({ maxPartySize: 8, bookingHours: HOURS }))
    expect(html).toContain('data-testid="booking-settings-party-line"')
    expect(html).toContain('bookingSettings.bookingHours.partyLine:{&quot;max&quot;:&quot;8&quot;}')
  })

  it('the summary box shows the GET summary in the page language; none yet → the placeholder', () => {
    summaryState.value = { loading: false, summary: { hoursSummary: { zh_hk: '可訂座時間：星期二至星期日', en: 'Diners can book Tue–Sun' } } }
    expect(render(simple({ bookingHours: HOURS }))).toContain('可訂座時間：星期二至星期日')
    summaryState.value = { loading: false, summary: null }
    expect(render(simple({ bookingHours: HOURS }))).toContain('bookingSettings.bookingHours.summaryNone')
  })

  it('Preview opens the admin preview route in a new tab', () => {
    const html = render(simple({ bookingHours: HOURS }))
    expect(html).toMatch(/href="\/dashboard\/booking-preview" target="_blank" rel="noopener noreferrer" data-testid="booking-settings-preview"/)
  })
})

describe('BOOK-009 save payload (AC-1, AC-5)', () => {
  it('AC-1: the stored hours round-trip through the form, the payload and the server parser', () => {
    const form = toForm(simple({ bookingHours: HOURS }))
    const payload = JSON.parse(JSON.stringify(toPayload(form)))
    expect(payload.bookingHours).toEqual(HOURS)
    const result = parseBookingSettings(payload, simple(), '2026-11-20')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.bookingHours).toEqual(HOURS)
  })

  it('AC-5: a restaurant without hours that never touched the table sends no bookingHours (stays not configured)', () => {
    const payload = JSON.parse(JSON.stringify(toPayload(toForm(simple()))))
    expect('bookingHours' in payload).toBe(false)
    const result = parseBookingSettings(payload, simple(), '2026-11-20')
    expect(result.ok && result.config.bookingHours).toBeNull()
  })

  it('opening one day turns hours on; outside Simple mode hours are never sent', () => {
    const form = toForm(simple())
    const opened = { ...form, bookingHours: setDayOpen(form.bookingHours, 'tue', true) }
    expect(toPayload(opened).bookingHours).toMatchObject({ weekly: { tue: [{ first: '12:00', last: '14:00' }] } })
    expect(toPayload({ ...opened, mode: 'off' }).bookingHours).toBeUndefined()
    expect(hasUnsavedChanges(opened, form)).toBe(true)
    expect(hasUnsavedChanges(form, form)).toBe(false)
  })

  it('stored hours emptied by the admin are still sent (the all-closed warning state)', () => {
    const form = toForm(simple({ bookingHours: HOURS }))
    expect(toPayload({ ...form, bookingHours: EMPTY_BOOKING_HOURS }).bookingHours).toEqual(EMPTY_BOOKING_HOURS)
  })
})

describe('BOOK-009 copy to days (AC-3)', () => {
  it('copy Tuesday to all days: every weekday row equals Tuesday; Mon–Fri and Sat–Sun only touch their days', () => {
    const all = copyDay(HOURS, 'tue', 'all')
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const) expect(all.weekly[day]).toEqual(HOURS.weekly.tue)
    const weekdays = copyDay({ ...HOURS, weekly: { ...HOURS.weekly, tue: [LUNCH] } }, 'tue', 'weekdays')
    expect(weekdays.weekly.mon).toEqual([LUNCH])
    expect(weekdays.weekly.sat).toEqual([LUNCH, DINNER])
    const weekend = copyDay(HOURS, 'mon', 'weekend')
    expect(weekend.weekly.sat).toEqual([])
    expect(weekend.weekly.fri).toEqual([LUNCH, DINNER])
  })

  it('a copy is a new value (no shared period objects) and saves nothing by itself', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const all = copyDay(HOURS, 'tue', 'all')
    all.weekly.mon[0].first = '11:00'
    expect(all.weekly.wed[0].first).toBe('12:00')
    expect(HOURS.weekly.tue[0].first).toBe('12:00')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('every row has a copy menu button', () => {
    const html = render(simple({ bookingHours: HOURS }))
    for (const day of ['mon', 'sun']) expect(html).toContain(`data-testid="booking-settings-hours-${day}-copy"`)
  })

  it('noBookableTimes: all closed and no open special date', () => {
    expect(noBookableTimes(EMPTY_BOOKING_HOURS)).toBe(true)
    expect(noBookableTimes(addSpecial(EMPTY_BOOKING_HOURS, '2026-12-24'))).toBe(true)
    expect(noBookableTimes(HOURS)).toBe(false)
  })
})

describe('BOOK-009 per-path errors on their rows (AC-2, A2 mockup)', () => {
  const errors = {
    'bookingHours.weekly.wed.0': 'last_before_first',
    'bookingHours.weekly.thu.1': 'overlap',
    'bookingHours.special.2026-12-25': 'past',
    'bookingHours.terms.en': 'too_long',
    'bookingHours.info.mapUrl': 'invalid_https_url',
  }

  it('lookups find the row and the period', () => {
    expect(dayError(errors, 'wed')).toEqual({ code: 'last_before_first', period: 0 })
    expect(dayError(errors, 'tue')).toBeNull()
    expect(specialError(errors, '2026-12-25', 0)).toBe('past')
    expect(specialError({ 'bookingHours.special.3': 'invalid_date' }, '', 3)).toBe('invalid_date')
    expect(errorCount(errors)).toBe(5)
  })

  it('each error renders on its own row/field, names the period, and the top line counts them', () => {
    const html = withOutcome(simple({ bookingHours: HOURS }), errors)
    expect(html).toContain('data-testid="booking-settings-hours-wed-error"')
    expect(html).toContain('bookingSettings.bookingHours.errors.last_before_first:{&quot;period&quot;:&quot;午市&quot;,&quot;first&quot;:&quot;12:00&quot;}')
    expect(html).toContain('data-testid="booking-settings-hours-thu-error"')
    expect(html).toContain('bookingSettings.bookingHours.errors.overlap:{&quot;period&quot;:&quot;晚市&quot;')
    expect(html).toMatch(/data-testid="booking-settings-hours-wed-period-0" data-invalid="true"/)
    expect(html).not.toContain('booking-settings-hours-tue-error')
    expect(html).toContain('data-testid="booking-settings-special-2026-12-25-error"')
    expect(html).toContain('data-testid="booking-settings-terms-en-error"')
    expect(html).not.toContain('booking-settings-terms-zh_hk-error')
    expect(html).toContain('data-testid="booking-settings-map-error"')
    expect(html).toContain('data-testid="booking-settings-not-saved"')
    expect(html).toContain('bookingSettings.bookingHours.notSaved:{&quot;count&quot;:5}')
  })

  it('an unknown code (unknown_field:x) reads as "check this", never a missing key', () => {
    const html = withOutcome(simple({ bookingHours: HOURS }), { 'bookingHours.weekly.mon': 'unknown_field:x' })
    expect(html).toContain('bookingSettings.bookingHours.errors.invalid')
  })
})
