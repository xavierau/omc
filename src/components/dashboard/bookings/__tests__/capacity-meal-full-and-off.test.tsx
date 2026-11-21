/**
 * BOOK-010 I-010: the staff Capacity block when the meal limit is reached
 * (the period reads full; its slots read "N / limit · Meal full", never
 * "Full" unless the slot itself is full or stopped) and when the restaurant
 * keeps booking hours with the schedule switch off ("Booking hours are off",
 * no switches).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
  useLocale: () => 'en',
}))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { CapacityBlock } from '../capacity-block'
import type { CapacityDayView } from '../use-booking-capacity'

const DATE = '2026-11-21'
type Slot = CapacityDayView['periods'][number]['slots'][number]
const slot = (time: string, guests: number, extra: Partial<Slot> = {}): Slot => ({
  time, guests, limit: 30, full: false, stopped: false, stoppedBy: null, stoppedAt: null, ...extra,
})
/** Dinner: 30 at 18:00 + 30 at 19:00 = the 60 meal limit; 20:00 has 0; 19:30 stopped. */
const DAY: CapacityDayView = {
  date: DATE, hoursSet: true, full: false, stopped: false, stoppedBy: null, stoppedAt: null,
  periods: [
    { key: 'Lunch', label: 'Lunch', first: '12:00', last: '14:00', guests: 14, limit: 60, full: false, stopped: false, stoppedBy: null, stoppedAt: null,
      slots: [slot('12:00', 8), slot('12:30', 6)] },
    { key: 'Dinner', label: 'Dinner', first: '18:00', last: '20:00', guests: 60, limit: 60, full: true, stopped: false, stoppedBy: null, stoppedAt: null,
      slots: [
        slot('18:00', 30, { full: true }),
        slot('19:00', 30, { full: true }),
        slot('19:30', 0, { full: true, stopped: true, stoppedBy: 'Amy', stoppedAt: '2026-11-21T06:02:00Z' }),
        slot('20:00', 0, { full: true }),
      ] },
  ],
}
const html = (day: CapacityDayView) => renderToStaticMarkup(<CapacityBlock day={day} error={false} note={null} onToggle={() => {}} />)

describe('meal limit reached (main review of W2 evidence 05r)', () => {
  it('the period reads full: Full badge on the period and the bar in the full colour', () => {
    const out = html(DAY)
    expect(out).toMatch(/data-testid="bookings-capacity-period-Dinner" data-state="full"/)
    expect(out).toContain('data-testid="bookings-capacity-period-Dinner-full"')
    expect(out).toMatch(/data-testid="bookings-capacity-period-Dinner-bar" data-state="full"/)
    expect(out).not.toContain('bookings-capacity-period-Lunch-full')
    expect(out).toMatch(/data-testid="bookings-capacity-period-Lunch-bar" data-state="open"/)
  })

  it('a slot with 0 / 30 reads "0 / 30" with Meal full, never Full', () => {
    const out = html(DAY)
    expect(out).toContain('bookings.capacity.slotOf:{&quot;guests&quot;:0,&quot;limit&quot;:30}')
    expect(out).toContain('data-testid="bookings-capacity-slot-2000-meal-full"')
    expect(out).not.toContain('bookings-capacity-slot-2000-full"')
    expect(out).toContain('bookings.capacity.mealFull')
  })

  it('Full only where the slot itself is full or stopped', () => {
    const out = html(DAY)
    expect(out).toContain('data-testid="bookings-capacity-slot-1900-full"')
    expect(out).not.toContain('bookings-capacity-slot-1900-meal-full')
    expect(out).toContain('data-testid="bookings-capacity-slot-1930-full"')
    expect(out).not.toContain('bookings-capacity-slot-1930-meal-full')
  })

  it('the period starts expanded when the meal is full', () => {
    const day = { ...DAY, periods: [{ ...DAY.periods[1], slots: [slot('20:00', 0, { full: true })] }] }
    expect(html(day)).toMatch(/aria-expanded="true"[^>]*data-testid="bookings-capacity-period-Dinner-toggle"/)
  })

  it('copy: Meal full / 餐已滿 and Booking hours are off in both languages', () => {
    expect(en.bookings.capacity.mealFull).toBe('Meal full')
    expect(zhHK.bookings.capacity.mealFull).toBe('餐已滿')
    expect(en.bookings.capacity.hoursOff).toMatch(/Booking hours are off/)
    expect(zhHK.bookings.capacity.hoursOff).toMatch(/訂座時段/)
  })
})

describe('schedule switch off (BOOK-009 scheduleEnabled)', () => {
  it('shows "Booking hours are off" and no switches', () => {
    const out = html({ ...DAY, hoursOff: true, periods: [] })
    expect(out).toContain('data-testid="bookings-capacity-off"')
    expect(out).toContain('bookings.capacity.hoursOff')
    expect(out).not.toContain('role="switch"')
  })

  it('no hours at all → nothing rendered (unchanged)', () => {
    expect(html({ ...DAY, hoursSet: false, periods: [] })).toBe('')
  })
})
