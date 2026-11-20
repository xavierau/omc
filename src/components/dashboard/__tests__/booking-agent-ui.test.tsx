// BOOK-003 (R43, AC-7): the "Allow AI agents" block under Simple booking and
// the "via AI agent" badge in the staff list.
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
// F4: a spy over the real hook, so a test can see who owns the agent block's state.
vi.mock('@/hooks/use-booking-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-booking-settings')>()
  return { ...actual, useAgentBookingSettings: vi.fn(actual.useAgentBookingSettings) }
})
vi.mock('@/hooks/use-booking-template-overview', () => ({
  useBookingTemplateOverview: () => ({ templates: null, editor: null, editingKind: null, toggle: () => {}, close: () => {}, onSaved: () => {} }),
}))

import { BookingList } from '../booking-list'
import { BookingSettingsSection } from '../booking-settings-section'
import { agentBookingOutcome, useAgentBookingSettings } from '@/hooks/use-booking-settings'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
import type { BookingItem } from '@/hooks/use-bookings'

const row = (id: string, source: BookingItem['source']): BookingItem => ({
  id, restaurantId: 'r', memberId: null, phone: '+85291234567', name: 'Chan', partySize: 4, bookingDate: '2026-11-20',
  bookingTime: '19:30', notes: null, status: 'pending', declineReason: null, decidedBy: null, decidedAt: null, source,
  campaignId: null, createdAt: '2026-11-19T00:00:00Z', decisionMessageStatus: null,
})

const section = (patch: Partial<typeof DEFAULT_BOOKING_CONFIG>) =>
  renderToStaticMarkup(<BookingSettingsSection initialConfig={{ ...DEFAULT_BOOKING_CONFIG, ...patch }} />)

describe('BOOK-003 dashboard UI', () => {
  it('Simple booking shows the toggle, host field and save; off and external do not', () => {
    const html = section({ mode: 'simple' })
    for (const id of ['booking-agent-settings', 'booking-agent-toggle', 'booking-agent-host', 'booking-agent-save']) {
      expect(html).toContain(`data-testid="${id}"`)
    }
    expect(html).toContain('bookingSettings.agent.toggle')
    expect(section({ mode: 'off' })).not.toContain('booking-agent-settings')
    expect(section({ mode: 'external', externalUrl: 'https://x.example' })).not.toContain('booking-agent-settings')
  })

  it('download and rotate appear only once agent booking is on with a host', () => {
    expect(section({ mode: 'simple' })).not.toContain('booking-agent-download')
    const on = section({ mode: 'simple', agentBooking: { enabled: true, publicId: 'P'.repeat(32), websiteHost: 'www.cafe.hk' } })
    expect(on).toContain('data-testid="booking-agent-download"')
    expect(on).toContain('data-testid="booking-agent-rotate"')
    expect(on).toContain('{&quot;host&quot;:&quot;www.cafe.hk&quot;}')
    expect(on).toMatch(/data-testid="booking-agent-toggle"[^>]*checked=""|checked=""[^>]*data-testid="booking-agent-toggle"/)
  })

  // No DOM in this repo's vitest (node env, no jsdom/testing-library), so the
  // Simple → External → Simple click-through cannot run here. What makes the
  // state survive it is that the section, which never unmounts on a mode
  // change, owns the agent block's state; these pin that.
  it('F4: the section holds the agent state even while the block is hidden (External, Off)', () => {
    for (const mode of ['external', 'off'] as const) {
      vi.mocked(useAgentBookingSettings).mockClear()
      const html = section({ mode, externalUrl: 'https://x.example' })
      expect(html).not.toContain('booking-agent-settings')
      expect(useAgentBookingSettings).toHaveBeenCalledTimes(1)
    }
  })

  it('G2: a download refused for no WhatsApp number shows its own message, not the generic failure', () => {
    const agentBooking = { enabled: true, publicId: 'P'.repeat(32), websiteHost: 'www.saved.hk' }
    vi.mocked(useAgentBookingSettings).mockImplementationOnce(() => ({
      stored: agentBooking, form: { enabled: true, websiteHost: 'www.saved.hk' }, update: () => {}, save: async () => {},
      rotate: async () => {}, download: async () => {}, busy: false, outcome: { kind: 'no_whatsapp_number' },
    }))
    const html = section({ mode: 'simple' })
    expect(html).toContain('data-testid="booking-agent-error"')
    expect(html).toContain('bookingSettings.agent.noWhatsappNumber')
    expect(html).not.toContain('bookingSettings.agent.downloadFailed')
  })

  it('F4: the block shows the state it is handed, not the page-load config', () => {
    const agentBooking = { enabled: true, publicId: 'P'.repeat(32), websiteHost: 'www.saved.hk' }
    vi.mocked(useAgentBookingSettings).mockImplementationOnce(() => ({
      stored: agentBooking, form: { enabled: true, websiteHost: 'www.saved.hk' }, update: () => {}, save: async () => {},
      rotate: async () => {}, download: async () => {}, busy: false, outcome: null,
    }))
    const html = section({ mode: 'simple' })
    expect(html).toContain('data-testid="booking-agent-download"')
    expect(html).toContain('www.saved.hk')
  })

  it('a booking made by an AI agent shows the badge; chat and campaign rows do not', () => {
    const html = renderToStaticMarkup(
      <BookingList bookings={[row('a1', 'agent'), row('c1', 'chat')]} busyIds={new Set()} undelivered={new Set()} onDecide={() => {}} />
    )
    expect(html).toContain('data-testid="booking-row-a1-via-agent"')
    expect(html).toContain('bookings.viaAgent')
    expect(html).not.toContain('booking-row-c1-via-agent')
  })

  it('maps the API answers to what the block shows', () => {
    const agentBooking = { enabled: true, publicId: 'P'.repeat(32), websiteHost: 'www.cafe.hk' }
    expect(agentBookingOutcome(200, { agentBooking }, 'saved')).toEqual({ kind: 'saved', agentBooking })
    expect(agentBookingOutcome(200, { agentBooking }, 'rotated')).toEqual({ kind: 'rotated', agentBooking })
    expect(agentBookingOutcome(400, { fields: { websiteHost: 'required' } }, 'saved')).toEqual({ kind: 'fields', errors: { websiteHost: 'required' } })
    expect(agentBookingOutcome(403, {}, 'saved')).toEqual({ kind: 'forbidden' })
    expect(agentBookingOutcome(500, {}, 'rotated')).toEqual({ kind: 'rotate_error' })
  })
})
