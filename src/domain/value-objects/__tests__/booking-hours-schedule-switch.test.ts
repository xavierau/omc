// BOOK-009 F1 (review P2-1 ruling, P3-1): the "Use booking hours" switch.
// Terms, info and table time work without the schedule; with the switch off
// every channel takes any time; an all-empty, switched-off value is unset (AC-5).
import { describe, it, expect } from 'vitest'
import {
  activeSchedule,
  bookingHoursInEffect,
  EMPTY_BOOKING_HOURS,
  resolveBookingHours,
  type BookingHours,
} from '../booking-hours'
import { parseBookingHoursSettings } from '../booking-hours-settings'
import { parseBookingSubmission } from '@/domain/services/booking-submission'
import { bookingRulesAt } from '@/application/booking/submit-booking-request'

const TODAY = '2026-11-20'
// Fri 2026-11-20 10:00 Hong Kong
const NOW = new Date('2026-11-20T02:00:00.000Z')
const DINNER = [{ first: '18:00', last: '21:00' }]
const SCHEDULE: BookingHours = { ...EMPTY_BOOKING_HOURS, weekly: { ...EMPTY_BOOKING_HOURS.weekly, fri: DINNER } }
const OFF: BookingHours = { ...EMPTY_BOOKING_HOURS, scheduleEnabled: false }
const body = { date: '2026-11-21', time: '03:00', partySize: '2', name: 'Chan' }

/** The value as stored or sent before F1: no scheduleEnabled key. */
function storedBeforeF1(hours: BookingHours): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...hours }
  delete copy.scheduleEnabled
  return copy
}

describe('resolveBookingHours: scheduleEnabled', () => {
  it('stored before F1 (no switch) and no period anywhere → off, so terms alone no longer close booking', () => {
    const stored = storedBeforeF1({ ...EMPTY_BOOKING_HOURS, terms: { zh_hk: '', en: 'No pets' } })
    expect(resolveBookingHours(stored)?.scheduleEnabled).toBe(false)
  })

  it('stored before F1 with a weekday period → on (pre-F1 behaviour kept)', () => {
    const stored = storedBeforeF1(SCHEDULE)
    expect(resolveBookingHours(stored)?.scheduleEnabled).toBe(true)
  })

  it('stored before F1 with only a special-date period → on', () => {
    const stored = storedBeforeF1({ ...EMPTY_BOOKING_HOURS, special: [{ date: '2026-12-24', periods: DINNER }] })
    expect(resolveBookingHours(stored)?.scheduleEnabled).toBe(true)
  })

  it('an explicit switch wins, either way', () => {
    expect(resolveBookingHours({ ...SCHEDULE, scheduleEnabled: false })?.scheduleEnabled).toBe(false)
    expect(resolveBookingHours({ ...EMPTY_BOOKING_HOURS, scheduleEnabled: true })?.scheduleEnabled).toBe(true)
  })

  it('P3-1: a stored mapUrl that is not a safe https link resolves to ""', () => {
    const info = (mapUrl: string) => resolveBookingHours({ ...OFF, info: { address: '', phone: '', mapUrl } })?.info.mapUrl
    expect(info('javascript:alert(1)')).toBe('')
    expect(info('http://maps.example/x')).toBe('')
    expect(info('https://maps.example/x')).toBe('https://maps.example/x')
  })
})

describe('parseBookingHoursSettings: scheduleEnabled', () => {
  it('round-trips the switch both ways', () => {
    for (const on of [true, false]) {
      const result = parseBookingHoursSettings({ ...SCHEDULE, scheduleEnabled: on }, TODAY)
      expect(result.ok && result.hours?.scheduleEnabled).toBe(on)
    }
  })

  it('absent (an older client) → derived from the periods, like the resolver', () => {
    const withPeriods = storedBeforeF1(SCHEDULE)
    const termsOnly = storedBeforeF1({ ...OFF, terms: { zh_hk: '請準時', en: '' } })
    expect(parseBookingHoursSettings(withPeriods, TODAY)).toMatchObject({ ok: true, hours: { scheduleEnabled: true } })
    expect(parseBookingHoursSettings(termsOnly, TODAY)).toMatchObject({ ok: true, hours: { scheduleEnabled: false } })
  })

  it('not a boolean → its own path error, nothing saved', () => {
    expect(parseBookingHoursSettings({ ...SCHEDULE, scheduleEnabled: 'yes' }, TODAY)).toEqual({
      ok: false,
      errors: { 'bookingHours.scheduleEnabled': 'invalid' },
    })
  })
})

describe('the shared rule check with the switch off', () => {
  const rules = (hours: BookingHours | null) => bookingRulesAt(NOW, { maxPartySize: 8, bookingHours: hours })

  it('terms only, switch off → any time is accepted, the terms tick is required', () => {
    const hours = { ...OFF, terms: { zh_hk: '', en: 'No pets' } }
    expect(parseBookingSubmission(body, rules(hours))).toEqual({ ok: false, errors: { acceptTerms: 'terms_required' } })
    expect(parseBookingSubmission({ ...body, acceptTerms: true }, rules(hours))).toMatchObject({ ok: true, submission: { time: '03:00', termsAccepted: true } })
  })

  it.each([
    ['info only', { info: { address: '銅鑼灣', phone: '', mapUrl: '' } }],
    ['table time only', { tableMinutes: 120 }],
  ] as const)('%s, switch off → any time, no tick', (_label, patch) => {
    expect(parseBookingSubmission(body, rules({ ...OFF, ...patch }))).toMatchObject({ ok: true })
  })

  it('switching off a real schedule returns to any time; switching it on refuses again', () => {
    expect(parseBookingSubmission(body, rules({ ...SCHEDULE, scheduleEnabled: false }))).toMatchObject({ ok: true })
    expect(parseBookingSubmission(body, rules(SCHEDULE))).toMatchObject({ ok: false, errors: { date: 'closed_day' } })
  })
})

describe('AC-5: what counts as set', () => {
  it('switch off with no terms, info or table time behaves as unset', () => {
    expect(bookingHoursInEffect(OFF)).toBeNull()
    expect(bookingHoursInEffect({ ...OFF, weekly: SCHEDULE.weekly })).toBeNull()
    expect(bookingHoursInEffect(null)).toBeNull()
  })

  it('switch off with any detail, or switch on, is in effect; only switch on is a schedule', () => {
    expect(bookingHoursInEffect({ ...OFF, tableMinutes: 90 })).not.toBeNull()
    expect(activeSchedule({ ...OFF, tableMinutes: 90 })).toBeNull()
    expect(activeSchedule(SCHEDULE)).toBe(SCHEDULE)
  })
})
