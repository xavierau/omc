// BOOK-001 W3-05/W3-10: the booking settings section shows each booking
// template's status per language (pending / approved / rejected / failed /
// not submitted), from GET on load and from the save response after a save.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}))

import { BookingTemplateStatusList } from '../booking-template-status-list'
import { BookingSettingsSection } from '../booking-settings-section'
import { saveOutcome } from '@/hooks/use-booking-settings'
import { parseBookingSettingsSummary } from '@/hooks/use-booking-availability'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
import type { BookingTemplateStatuses } from '@/domain/services/booking-templates'

const statuses: BookingTemplateStatuses = {
  received: { en: 'approved', zh_hk: 'pending' },
  confirmed: { en: 'rejected', zh_hk: 'failed' },
  declined: { en: 'not_submitted', zh_hk: 'approved' },
  reminder: { en: 'pending', zh_hk: 'pending' },
}

describe('BookingTemplateStatusList', () => {
  it('shows every kind × language with its status', () => {
    const html = renderToStaticMarkup(<BookingTemplateStatusList statuses={statuses} />)
    expect(html).toContain('data-testid="booking-template-statuses"')
    expect(html).toMatch(/data-testid="booking-template-status-received-en"[^>]*>bookingSettings\.templates\.status\.approved/)
    expect(html).toMatch(/data-testid="booking-template-status-confirmed-zh_hk"[^>]*>bookingSettings\.templates\.status\.failed/)
    expect(html).toMatch(/data-testid="booking-template-status-declined-en"[^>]*>bookingSettings\.templates\.status\.not_submitted/)
    expect(html.match(/data-testid="booking-template-status-[a-z]+-(en|zh_hk)"/g)).toHaveLength(8)
  })

  it('says the statuses are unknown when they could not be read', () => {
    expect(renderToStaticMarkup(<BookingTemplateStatusList statuses={null} />)).toContain(
      'data-testid="booking-template-status-unknown"'
    )
  })
})

describe('settings section', () => {
  it('Simple mode shows the template status block; External does not', () => {
    const simple = renderToStaticMarkup(<BookingSettingsSection initialConfig={{ ...DEFAULT_BOOKING_CONFIG, mode: 'simple' }} />)
    expect(simple).toContain('bookingSettings.templates.title')
    const external = renderToStaticMarkup(
      <BookingSettingsSection initialConfig={{ ...DEFAULT_BOOKING_CONFIG, mode: 'external', externalUrl: 'https://inline.app/x' }} />
    )
    expect(external).not.toContain('bookingSettings.templates.title')
  })
})

describe('response parsing', () => {
  it('a save response carries the template statuses', () => {
    const config = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple' as const }
    expect(saveOutcome(200, { config, templates: statuses })).toEqual({ kind: 'saved', config, templates: statuses })
    expect(saveOutcome(200, { config, templates: { bogus: true } })).toEqual({ kind: 'saved', config, templates: null })
  })

  it('GET summary: mode, external URL and statuses; malformed → null', () => {
    expect(parseBookingSettingsSummary({ mode: 'external', externalUrl: 'https://inline.app/x', templates: statuses })).toEqual({
      availability: { mode: 'external', externalUrl: 'https://inline.app/x' },
      templates: statuses,
    })
    expect(parseBookingSettingsSummary({ mode: 'weird' })).toBeNull()
    expect(parseBookingSettingsSummary(null)).toBeNull()
  })
})
