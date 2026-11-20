// AGENT-005 AC-3: the 訂座規則 / Booking rules textarea in Settings → Booking.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
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

import { BookingSettingsSection } from '../booking-settings-section'
import { toForm, useBookingSettings } from '@/hooks/use-booking-settings'
import { BOOKING_RULES_MAX_CHARS, DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'

const section = (patch: Partial<typeof DEFAULT_BOOKING_CONFIG>) =>
  renderToStaticMarkup(<BookingSettingsSection initialConfig={{ ...DEFAULT_BOOKING_CONFIG, ...patch }} />)

describe('AGENT-005 booking rules field', () => {
  it.each(['simple', 'external'] as const)('mode %s shows the textarea with its label, hint and stored text', (mode) => {
    const html = section({ mode, externalUrl: 'https://x.example', bookingRules: 'Last order 20:30' })
    expect(html).toMatch(/<textarea[^>]*data-testid="booking-settings-rules"/)
    expect(html).toContain('bookingSettings.bookingRules')
    expect(html).toContain('data-testid="booking-settings-rules-hint"')
    expect(html).toContain('bookingSettings.bookingRulesHint')
    expect(html).toContain('Last order 20:30')
    expect(html).toContain(`maxLength="${BOOKING_RULES_MAX_CHARS}"`)
    expect(html).toMatch(/<label[^>]*for="booking-settings-rules"/)
  })

  it('mode off hides it', () => {
    const html = section({ mode: 'off', bookingRules: 'Last order 20:30' })
    expect(html).not.toContain('booking-settings-rules')
    expect(html).not.toContain('Last order 20:30')
  })

  it('a too_long field error is shown under the field', () => {
    vi.mocked(useBookingSettings).mockImplementationOnce(() => ({
      form: { ...toForm({ ...DEFAULT_BOOKING_CONFIG, mode: 'simple' }) },
      update: () => {}, save: async () => {}, saving: false,
      outcome: { kind: 'fields', errors: { bookingRules: 'too_long' } },
    }))
    const html = section({ mode: 'simple' })
    expect(html).toContain('data-testid="booking-settings-rules-error"')
    expect(html).toContain('bookingSettings.errors.too_long')
  })

  it('it saves with the rest of the section: one Save button, the field is part of the section form', () => {
    const html = section({ mode: 'simple', bookingRules: 'R' })
    expect(html.match(/data-testid="booking-settings-save"/g)).toHaveLength(1)
    expect(toForm({ ...DEFAULT_BOOKING_CONFIG, bookingRules: 'R' }).bookingRules).toBe('R')
  })
})
