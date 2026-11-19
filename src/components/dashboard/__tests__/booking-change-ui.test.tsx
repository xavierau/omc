// AGENT-003 R23/R24: 訂座 shows a change request's old → new slot and who cancelled a booking.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const usedKeys = new Set<string>()
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
    usedKeys.add(`${ns}.${key}`)
    return vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`
  },
}))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { BookingRow } from '../booking-row'
import type { BookingItem } from '@/hooks/use-bookings'

const base: BookingItem = {
  id: 'b-new', restaurantId: 'r', memberId: null, phone: '+85291234567', name: '陳生', partySize: 4, bookingDate: '2026-11-26',
  bookingTime: '20:00', notes: null, status: 'pending', declineReason: null, decidedBy: null, decidedAt: null, source: 'agent',
  campaignId: null, createdAt: '2026-11-19T00:00:00Z', decisionMessageStatus: null,
}
const render = (b: BookingItem) => renderToStaticMarkup(<BookingRow booking={b} busy={false} undelivered={false} onDecide={() => {}} />)
const lookup = (m: unknown, p: string) => p.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), m)

describe('AGENT-003 訂座 rows', () => {
  it('AC-R23 a change request shows old → new and keeps Confirm / Decline', () => {
    const html = render({ ...base, replacesBookingId: 'b-old', replaces: { bookingDate: '2026-11-25', bookingTime: '19:30', partySize: 4 } })
    expect(html).toContain('data-testid="booking-row-b-new-change-from"')
    expect(html).toContain('bookings.changeFrom:')
    expect(html).toContain('2026-11-25 19:30')
    expect(html).toContain('2026-11-26 20:00')
    expect(html).toContain('data-testid="booking-row-b-new-confirm"')
  })

  it('AC-R24 a booking the diner cancelled through the AI shows Cancelled + the diner marker, no actions', () => {
    const html = render({ ...base, id: 'b-c', status: 'cancelled', cancelledBy: 'diner_ai', source: 'chat' })
    expect(html).toContain('bookings.status.cancelled')
    expect(html).toContain('data-testid="booking-row-b-c-cancelled-by-diner"')
    expect(html).not.toContain('booking-row-b-c-confirm')
  })

  it('AC-R23 a booking replaced by a confirmed change says so', () => {
    const html = render({ ...base, id: 'b-old', status: 'cancelled', cancelledBy: 'change' })
    expect(html).toContain('data-testid="booking-row-b-old-cancelled-by-change"')
  })

  it('AC-R24 every key the new row states use exists in en and zh-HK', () => {
    usedKeys.clear()
    render({ ...base, replacesBookingId: 'b-old', replaces: { bookingDate: '2026-11-25', bookingTime: '19:30', partySize: 4 } })
    render({ ...base, replacesBookingId: 'b-old', replaces: null })
    render({ ...base, status: 'cancelled', cancelledBy: 'diner_ai' })
    render({ ...base, status: 'cancelled', cancelledBy: 'change' })
    usedKeys.add('bookings.alreadyHandledStatus.cancelled')
    const missing = [...usedKeys].filter((k) => typeof lookup(en, k) !== 'string' || typeof lookup(zhHK, k) !== 'string')
    expect(missing).toEqual([])
  })
})
