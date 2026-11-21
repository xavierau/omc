// BOOK-009 F1 (review P2-1 ruling): Settings → Booking gets the "Use booking
// hours" switch at the top of the hours block. Off: the hours, window and
// special-date blocks are hidden, terms/info/table time stay editable, and a
// terms-only / info-only / table-time-only save keeps the switch off.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}))
vi.mock('@/hooks/use-booking-availability', () => ({
  useBookingSettingsSummaryState: () => ({ loading: false, summary: null }),
  parseTemplateStatuses: () => null,
}))
vi.mock('@/hooks/use-booking-template-overview', () => ({
  useBookingTemplateOverview: () => ({ templates: null, editor: null, editingKind: null, toggle: () => {}, close: () => {}, onSaved: () => {} }),
}))

import { BookingSettingsSection } from '../booking-settings-section'
import { toForm, toPayload, UNSET_BOOKING_HOURS, type BookingSettingsForm } from '@/hooks/use-booking-settings'
import { DEFAULT_BOOKING_CONFIG, parseBookingSettings, resolveBookingConfig, type BookingConfig } from '@/domain/value-objects/booking-config'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'

const DINNER = [{ first: '18:00', last: '21:00' }]
const SCHEDULE: BookingHours = { ...EMPTY_BOOKING_HOURS, weekly: { ...EMPTY_BOOKING_HOURS.weekly, fri: DINNER, sat: DINNER } }
const simple = (patch: Partial<BookingConfig> = {}): BookingConfig => ({ ...DEFAULT_BOOKING_CONFIG, mode: 'simple', ...patch })
const render = (config: BookingConfig) => renderToStaticMarkup(<BookingSettingsSection initialConfig={config} />)
const SCHEDULE_BLOCKS = ['booking-settings-hours-mon', 'booking-settings-interval', 'booking-settings-notice', 'booking-settings-ahead', 'booking-settings-special-add']
const ALWAYS = ['booking-settings-schedule-switch', 'booking-settings-table-time', 'booking-settings-terms-zh_hk', 'booking-settings-info-address']

/** The form after the admin edits only `hours` fields, then the server's view of the save. */
function save(edit: (h: BookingHours) => BookingHours, from: BookingConfig = simple()) {
  const form: BookingSettingsForm = toForm(from)
  const payload = JSON.parse(JSON.stringify(toPayload({ ...form, bookingHours: edit(form.bookingHours) })))
  const parsed = parseBookingSettings(payload, from, '2026-11-20')
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
  return { payload, stored: resolveBookingConfig(JSON.parse(JSON.stringify(parsed.config))) }
}

describe('render', () => {
  it('a restaurant without hours: switch off, schedule blocks hidden, details editable', () => {
    const html = render(simple())
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*data-testid="booking-settings-schedule-switch"/)
    for (const id of SCHEDULE_BLOCKS) expect(html).not.toContain(`data-testid="${id}"`)
    for (const id of ALWAYS) expect(html).toContain(`data-testid="${id}"`)
    expect(html).toContain('data-testid="booking-settings-hours-not-set"')
  })

  it('switch on: every block shows, the off hint does not', () => {
    const html = render(simple({ bookingHours: SCHEDULE }))
    for (const id of [...SCHEDULE_BLOCKS, ...ALWAYS]) expect(html).toContain(`data-testid="${id}"`)
    expect(html).toMatch(/role="switch" aria-checked="true"[^>]*data-testid="booking-settings-schedule-switch"/)
    expect(html).not.toContain('booking-settings-hours-not-set')
  })

  it('a switched-off schedule keeps its periods stored but hides them', () => {
    const html = render(simple({ bookingHours: { ...SCHEDULE, scheduleEnabled: false } }))
    for (const id of SCHEDULE_BLOCKS) expect(html).not.toContain(`data-testid="${id}"`)
  })
})

describe('save payload', () => {
  it.each([
    ['terms only', (h: BookingHours) => ({ ...h, terms: { zh_hk: '請準時', en: '' } })],
    ['info only', (h: BookingHours) => ({ ...h, info: { ...h.info, address: '銅鑼灣' } })],
    ['table time only', (h: BookingHours) => ({ ...h, tableMinutes: 120 as const })],
  ])('%s saves with the switch off', (_label, edit) => {
    const { payload, stored } = save(edit)
    expect(payload.bookingHours.scheduleEnabled).toBe(false)
    expect(stored.bookingHours?.scheduleEnabled).toBe(false)
  })

  it('an untouched form still sends no bookingHours (AC-5)', () => {
    expect('bookingHours' in JSON.parse(JSON.stringify(toPayload(toForm(simple()))))).toBe(false)
    expect(toForm(simple()).bookingHours).toEqual(UNSET_BOOKING_HOURS)
  })

  it('the switch round-trips: on, then off, then on again with the periods kept', () => {
    const on = save((h) => ({ ...h, ...SCHEDULE, scheduleEnabled: true })).stored
    expect(on.bookingHours).toMatchObject({ scheduleEnabled: true, weekly: SCHEDULE.weekly })
    const off = save((h) => ({ ...h, scheduleEnabled: false }), on).stored
    expect(off.bookingHours).toMatchObject({ scheduleEnabled: false, weekly: SCHEDULE.weekly })
    const back = save((h) => ({ ...h, scheduleEnabled: true }), off).stored
    expect(back.bookingHours).toEqual(on.bookingHours)
  })
})
