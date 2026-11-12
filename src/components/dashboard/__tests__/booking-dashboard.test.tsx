import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}))
vi.mock('next/link', () => ({ default: (p: { href: string; children: unknown }) => p.children }))

import { BookingList } from '../booking-list'
import { BookingSettingsSection } from '../booking-settings-section'
import { bookingsNavItem } from '../sidebar'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
import type { BookingItem } from '@/hooks/use-bookings'

const row = (id: string, status: BookingItem['status']): BookingItem => ({
  id, restaurantId: 'r', memberId: null, phone: '+85291234567', name: '<b>Chan</b>', partySize: 4,
  bookingDate: '2026-11-13', bookingTime: '19:30', notes: '<img src=x onerror=alert(1)>', status,
  declineReason: null, decidedBy: null, decidedAt: null, source: 'chat', campaignId: null, createdAt: '2026-11-12T00:00:00Z',
})

const list = (props: Partial<Parameters<typeof BookingList>[0]>) =>
  renderToStaticMarkup(
    <BookingList bookings={[]} busyId={null} undelivered={new Set()} notice={null} onDecide={() => {}} {...props} />
  )

describe('Bookings dashboard', () => {
  it('reachable: the sidebar Bookings entry points at /dashboard/bookings', () => {
    expect(bookingsNavItem((k) => `t:${k}`)).toMatchObject({ label: 't:bookings', href: '/dashboard/bookings' })
  })

  it('shows the empty state', () => {
    const html = list({})
    expect(html).toContain('data-testid="booking-list-empty"')
    expect(html).toContain('bookings.emptyTitle')
  })

  it('lists rows with Confirm/Decline on pending only, diner text escaped', () => {
    const html = list({ bookings: [row('b1', 'pending'), row('b2', 'confirmed')] })
    expect(html).toContain('data-testid="booking-row-b1-confirm"')
    expect(html).toContain('data-testid="booking-row-b1-decline"')
    expect(html).not.toContain('booking-row-b2-confirm')
    expect(html).toContain('&lt;b&gt;Chan&lt;/b&gt;')
    expect(html).not.toContain('<img src=x')
  })

  it('AC-14 warning: a decided row whose message failed shows the not-delivered badge', () => {
    const html = list({ bookings: [row('b2', 'confirmed')], undelivered: new Set(['b2']) })
    expect(html).toContain('data-testid="booking-row-b2-not-delivered"')
    expect(html).toContain('bookings.notDelivered')
    expect(html).toContain('bookings.status.confirmed')
  })

  it('shows sent and already-handled notices', () => {
    expect(list({ bookings: [row('b1', 'pending')], notice: { kind: 'sent', decision: 'confirm' } })).toContain(
      'bookings.confirmationSent'
    )
    expect(list({ bookings: [row('b1', 'pending')], notice: { kind: 'already_handled', status: 'declined' } })).toContain(
      'bookings.alreadyHandled'
    )
  })

  it('settings: external mode with no URL shows the add-link hint and disables Save', () => {
    const html = renderToStaticMarkup(<BookingSettingsSection initialConfig={{ ...DEFAULT_BOOKING_CONFIG, mode: 'external' }} />)
    expect(html).toContain('data-testid="booking-settings-url-warning"')
    expect(html).toMatch(/data-testid="booking-settings-save"[^>]*disabled|disabled[^>]*data-testid="booking-settings-save"/)
  })

  it('settings: simple mode shows lifetimes with No expiry and the max party size', () => {
    const html = renderToStaticMarkup(
      <BookingSettingsSection initialConfig={{ ...DEFAULT_BOOKING_CONFIG, mode: 'simple', chatLinkTtlHours: null }} />
    )
    expect(html).toContain('data-testid="booking-settings-chat-no-expiry"')
    expect(html).toContain('data-testid="booking-settings-max-party"')
  })
})
