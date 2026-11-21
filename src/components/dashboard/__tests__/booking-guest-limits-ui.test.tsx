// BOOK-010 W2 (spec S1, AC-1, AC-2, AC-3; brief "Settings"): the 人數上限 Guest limits block in Settings → Booking.
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
vi.mock('@/hooks/use-booking-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-booking-settings')>()
  return { ...actual, useBookingSettings: vi.fn(actual.useBookingSettings) }
})
vi.mock('@/hooks/use-booking-template-overview', () => ({
  useBookingTemplateOverview: () => ({ templates: null, editor: null, editingKind: null, toggle: () => {}, close: () => {}, onSaved: () => {} }),
}))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { BookingSettingsSection } from '../booking-settings-section'
import { hasUnsavedChanges, scheduleInUse, toForm, toPayload, useBookingSettings } from '@/hooks/use-booking-settings'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'

const LUNCH = { label: '午市', first: '12:00', last: '14:00' }
const DINNER = { label: '晚市', first: '18:00', last: '21:30' }
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: [], tue: [LUNCH, DINNER], wed: [LUNCH, DINNER], thu: [LUNCH, DINNER], fri: [LUNCH, DINNER], sat: [LUNCH, DINNER], sun: [LUNCH, DINNER] },
}
const simple = (patch: Partial<BookingConfig> = {}): BookingConfig => ({ ...DEFAULT_BOOKING_CONFIG, mode: 'simple', ...patch })
const render = (config: BookingConfig) => renderToStaticMarkup(<BookingSettingsSection initialConfig={config} />)
const withLimits = (perSlot: number | null, perMeal: number | null) => simple({ bookingHours: { ...HOURS, limits: { perSlot, perMeal } } })

function withErrors(config: BookingConfig, errors: Record<string, string>) {
  vi.mocked(useBookingSettings).mockImplementationOnce(() => ({
    form: toForm(config), update: () => {}, save: async () => {}, saving: false, outcome: { kind: 'fields', errors },
  }))
  return render(config)
}

const idx = (html: string, id: string) => html.indexOf(`data-testid="${id}"`)

describe('guest limits block render (S1)', () => {
  it('sits after party size / table time and before terms, with both fields, hint and worked example', () => {
    const html = render(simple({ bookingHours: HOURS }))
    const order = ['booking-settings-table-time', 'booking-settings-limits', 'booking-settings-limit-slot', 'booking-settings-limit-meal',
      'booking-settings-limit-example', 'booking-settings-terms-zh_hk'].map((id) => idx(html, id))
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('bookingSettings.bookingHours.limits.title')
    expect(html).toContain('bookingSettings.bookingHours.limits.hint')
    expect(html).toContain('bookingSettings.bookingHours.limits.example')
  })

  it('AC-1: stored limits show in the fields; none stored → both empty (no limit)', () => {
    const html = render(withLimits(30, 60))
    expect(html).toMatch(/value="30"[^>]*data-testid="booking-settings-limit-slot"|data-testid="booking-settings-limit-slot"[^>]*value="30"/)
    expect(html).toMatch(/value="60"[^>]*data-testid="booking-settings-limit-meal"|data-testid="booking-settings-limit-meal"[^>]*value="60"/)
    const none = render(simple({ bookingHours: HOURS }))
    expect(none).toMatch(/value=""[^>]*data-testid="booking-settings-limit-slot"|data-testid="booking-settings-limit-slot"[^>]*value=""/)
  })

  it('only while the booking-hours schedule is in use: hidden for a restaurant without hours, and outside Simple', () => {
    expect(render(simple())).not.toContain('booking-settings-limits')
    expect(render({ ...withLimits(30, 60), mode: 'external', externalUrl: 'https://x.example' })).not.toContain('booking-settings-limits')
    expect(scheduleInUse(toForm(simple()))).toBe(false)
    expect(scheduleInUse(toForm(simple({ bookingHours: HOURS })))).toBe(true)
    // Hours being edited (not saved yet) also count as in use.
    expect(scheduleInUse({ ...toForm(simple()), bookingHours: HOURS })).toBe(true)
  })

  it('AC-2: per-path errors show on their field (invalid, above_meal), and an error on the whole value shows on the slot field', () => {
    const html = withErrors(withLimits(30, 60), { 'bookingHours.limits.perSlot': 'above_meal', 'bookingHours.limits.perMeal': 'invalid' })
    expect(html).toContain('data-testid="booking-settings-limit-slot-error"')
    expect(html).toContain('bookingSettings.bookingHours.limits.errors.above_meal')
    expect(html).toContain('data-testid="booking-settings-limit-meal-error"')
    expect(html).toContain('bookingSettings.bookingHours.limits.errors.invalid')
    expect(html).toMatch(/aria-invalid="true"[^>]*data-testid="booking-settings-limit-meal"|data-testid="booking-settings-limit-meal"[^>]*aria-invalid="true"/)
    const whole = withErrors(withLimits(30, 60), { 'bookingHours.limits': 'invalid' })
    expect(whole).toContain('data-testid="booking-settings-limit-slot-error"')
  })

  it('no error → no error lines', () => {
    const html = render(withLimits(30, 60))
    expect(html).not.toContain('booking-settings-limit-slot-error')
    expect(html).not.toContain('booking-settings-limit-meal-error')
  })
})

describe('guest limits payload (saved with the section Save)', () => {
  it('AC-1: both limits ride in bookingHours.limits as whole numbers', () => {
    const form = { ...toForm(simple({ bookingHours: HOURS })), limitPerSlot: '30', limitPerMeal: '60' }
    expect((toPayload(form).bookingHours as BookingHours).limits).toEqual({ perSlot: 30, perMeal: 60 })
  })

  it('an empty field is no limit (null); both empty → limits left out', () => {
    const one = { ...toForm(simple({ bookingHours: HOURS })), limitPerSlot: '', limitPerMeal: ' 60 ' }
    expect((toPayload(one).bookingHours as BookingHours).limits).toEqual({ perSlot: null, perMeal: 60 })
    const none = toForm(withLimits(null, null))
    expect(toPayload(none).bookingHours).not.toHaveProperty('limits')
  })

  it('AC-2: what the server must refuse is sent as typed so the field gets its code (0, negative, decimal, text)', () => {
    for (const typed of ['0', '-3', '2.5', 'abc']) {
      const form = { ...toForm(simple({ bookingHours: HOURS })), limitPerSlot: typed, limitPerMeal: '' }
      const sent = (toPayload(form).bookingHours as { limits: { perSlot: unknown } }).limits.perSlot
      expect(typed === '0' ? sent === 0 : sent === typed, `${typed} → ${JSON.stringify(sent)}`).toBe(true)
    }
  })

  it('AC-3: a restaurant without hours sends no bookingHours at all (limits never turn hours on)', () => {
    expect(toPayload(toForm(simple())).bookingHours).toBeUndefined()
  })

  it('stored limits load into the form and an untouched form has no unsaved changes', () => {
    const config = withLimits(30, 60)
    const form = toForm(config)
    expect([form.limitPerSlot, form.limitPerMeal]).toEqual(['30', '60'])
    expect(form.bookingHours).not.toHaveProperty('limits')
    expect(hasUnsavedChanges(form, toForm(config))).toBe(false)
    expect(hasUnsavedChanges({ ...form, limitPerMeal: '70' }, toForm(config))).toBe(true)
  })
})

describe('copy (en + zh-HK)', () => {
  it('both locales carry every guest-limit string', () => {
    for (const m of [en, zhHK]) {
      const l = (m.bookingSettings.bookingHours as unknown as { limits: Record<string, unknown> }).limits
      for (const key of ['title', 'hint', 'perSlot', 'perSlotHint', 'perMeal', 'perMealHint', 'unit', 'example']) expect(l[key], key).toBeTruthy()
      expect(Object.keys(l.errors as object).sort()).toEqual(['above_meal', 'invalid'])
    }
    expect((zhHK.bookingSettings.bookingHours as unknown as { limits: { title: string } }).limits.title).toBe('人數上限')
  })
})
