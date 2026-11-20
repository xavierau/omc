// BOOK-010 AC-1/AC-2 (domain): guest limits resolve field by field, a save is
// validated per path, and the summary line names them (spec S1).
import { describe, it, expect } from 'vitest'
import { EMPTY_BOOKING_HOURS, resolveBookingHours, type BookingHours } from '@/domain/value-objects/booking-hours'
import { parseBookingHoursSettings } from '@/domain/value-objects/booking-hours-settings'
import { summarize } from '@/domain/services/booking-hours'
import { summarizeForAgents } from '@/domain/services/agent-booking'

const TODAY = '2026-11-20'
const open = [{ label: '晚市', first: '18:00', last: '21:30' }]
const HOURS: BookingHours = { ...EMPTY_BOOKING_HOURS, weekly: { ...EMPTY_BOOKING_HOURS.weekly, sat: open } }

describe('limits resolve (stored value)', () => {
  it('field by field: a bad value is no limit, the other stands', () => {
    expect(resolveBookingHours({ ...HOURS, limits: { perSlot: 30, perMeal: 0 } })?.limits).toEqual({ perSlot: 30, perMeal: null })
    expect(resolveBookingHours({ ...HOURS, limits: { perSlot: 'x', perMeal: 60 } })?.limits).toEqual({ perSlot: null, perMeal: 60 })
  })

  it('AC-3: absent → no limits field (every tenant today)', () => {
    expect(resolveBookingHours(HOURS)).not.toHaveProperty('limits')
  })
})

describe('AC-2 limits save validation', () => {
  const save = (limits: unknown) => parseBookingHoursSettings({ ...HOURS, limits }, TODAY)

  it('AC-1: 30 per slot and 60 per meal save', () => {
    expect(save({ perSlot: 30, perMeal: 60 })).toEqual({ ok: true, hours: { ...HOURS, limits: { perSlot: 30, perMeal: 60 } } })
  })

  it('empty fields (null or "") = no limit', () => {
    expect(save({ perSlot: null, perMeal: '' })).toMatchObject({ ok: true, hours: { limits: { perSlot: null, perMeal: null } } })
  })

  it.each([0, -1, 2.5, '30', 1000])('AC-2: %s is refused on its own field', (bad) => {
    expect(save({ perSlot: bad, perMeal: 60 })).toEqual({ ok: false, errors: { 'bookingHours.limits.perSlot': 'invalid' } })
    expect(save({ perSlot: 30, perMeal: bad })).toMatchObject({ ok: false, errors: { 'bookingHours.limits.perMeal': 'invalid' } })
  })

  it('AC-2: a slot limit above the meal limit is refused on the slot field', () => {
    expect(save({ perSlot: 70, perMeal: 60 })).toEqual({ ok: false, errors: { 'bookingHours.limits.perSlot': 'above_meal' } })
  })

  it('a malformed limits object or an unknown key is refused', () => {
    expect(save([])).toEqual({ ok: false, errors: { 'bookingHours.limits': 'invalid' } })
    expect(save({ perDay: 3 })).toEqual({ ok: false, errors: { 'bookingHours.limits': 'unknown_field:perDay' } })
  })

  it('no limits key → saved without one (BOOK-009 payloads unchanged)', () => {
    expect(parseBookingHoursSettings(HOURS, TODAY)).toEqual({ ok: true, hours: HOURS })
  })
})

describe('AC-1 summary line', () => {
  const limited = { ...HOURS, limits: { perSlot: 30, perMeal: 60 } }

  it('zh-HK and en name both limits', () => {
    expect(summarize(limited, 8, 'zh_hk')).toContain('每個時段最多 30 位，每餐最多 60 位')
    expect(summarize(limited, 8, 'en')).toContain('Up to 30 guests per time slot, up to 60 guests per meal.')
  })

  it('one limit only; none → BOOK-009 text unchanged', () => {
    expect(summarize({ ...HOURS, limits: { perSlot: null, perMeal: 60 } }, 8, 'zh_hk')).toContain('每餐最多 60 位。')
    expect(summarize({ ...HOURS, limits: { perSlot: null, perMeal: null } }, 8, 'en')).toBe(summarize(HOURS, 8, 'en'))
  })

  it('AC-15: agents never get the numbers', () => {
    expect(summarizeForAgents(limited, 8, 'en', TODAY)).toBe(summarizeForAgents(HOURS, 8, 'en', TODAY))
  })
})
