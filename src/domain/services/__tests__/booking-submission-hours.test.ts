// BOOK-009 AC-8 / AC-5 (plan D2): the shared submission parser enforces the
// booking hours and the terms when the restaurant set them, and behaves
// exactly as before when it did not. 2026-11-23 is a Monday.
import { describe, it, expect } from 'vitest'
import { parseBookingSubmission } from '../booking-submission'
import type { BookingHours } from '@/domain/value-objects/booking-hours'

const OPEN = [{ first: '12:00', last: '14:00' }, { first: '18:00', last: '21:30' }]
const HOURS: BookingHours = {
  scheduleEnabled: true,
  weekly: { mon: [], tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN, sun: OPEN },
  intervalMinutes: 30,
  noticeHours: 2,
  aheadDays: 30,
  special: [],
  tableMinutes: null,
  terms: { zh_hk: '', en: '' },
  info: { address: '', phone: '', mapUrl: '' },
}
const base = { today: '2026-11-20', nowTime: '12:00', maxPartySize: 20 }
const rules = { ...base, hours: HOURS, termsRequired: false }
const valid = { date: '2026-11-24', time: '19:30', partySize: 4, name: 'Chan', notes: null }

function errorsFor(body: unknown, r: Parameters<typeof parseBookingSubmission>[1] = rules) {
  const result = parseBookingSubmission(body, r)
  if (result.ok) throw new Error('expected a rejection')
  return result.errors
}

describe('parseBookingSubmission with booking hours (AC-8)', () => {
  it('a slot on the grid, in the window and past the notice is accepted', () => {
    expect(parseBookingSubmission(valid, rules)).toEqual({ ok: true, submission: valid })
  })

  it.each([
    ['a closed day', { date: '2026-11-23' }, { date: 'closed_day' }],
    ['a time off the grid', { time: '19:15' }, { time: 'outside_hours' }],
    ['a time outside the periods', { time: '16:00' }, { time: 'outside_hours' }],
    ['inside the minimum notice', { date: '2026-11-20', time: '13:30' }, { time: 'too_soon' }],
    ['past the window', { date: '2026-12-21' }, { time: 'too_far' }],
  ])('%s → its field code, nothing else', (_label, patch, expected) => {
    expect(errorsFor({ ...valid, ...patch })).toEqual(expected)
  })

  it('earlier checks win: a past date, a past time today, a malformed time', () => {
    expect(errorsFor({ ...valid, date: '2026-11-19' })).toEqual({ date: 'past' })
    expect(errorsFor({ ...valid, date: '2026-11-20', time: '12:00' })).toEqual({ time: 'past_time' })
    expect(errorsFor({ ...valid, time: '7pm' })).toEqual({ time: 'invalid' })
  })
})

describe('terms acceptance (AC-8, AC-10)', () => {
  const withTerms = { ...rules, termsRequired: true }

  it.each([
    ['missing', {}, { acceptTerms: 'terms_required' }],
    ['false', { acceptTerms: false }, { acceptTerms: 'terms_required' }],
    ['not a boolean', { acceptTerms: 'yes' }, { acceptTerms: 'invalid' }],
  ])('acceptTerms %s → refused', (_label, patch, expected) => {
    expect(errorsFor({ ...valid, ...patch }, withTerms)).toEqual(expected)
  })

  it('accepted terms are carried on the submission', () => {
    expect(parseBookingSubmission({ ...valid, acceptTerms: true }, withTerms)).toEqual({
      ok: true,
      submission: { ...valid, termsAccepted: true },
    })
  })

  it('terms are checked without booking hours too', () => {
    expect(errorsFor(valid, { ...base, hours: null, termsRequired: true })).toEqual({ acceptTerms: 'terms_required' })
  })

  it('without terms, acceptTerms is allowed and ignored', () => {
    expect(parseBookingSubmission({ ...valid, acceptTerms: true }, rules)).toEqual({ ok: true, submission: valid })
  })
})

describe('AC-5: hours null and no terms behave exactly as before', () => {
  const off = { ...base, hours: null, termsRequired: false }

  it.each([
    valid,
    { ...valid, date: '2026-11-23', time: '03:00' },
    { ...valid, date: '2027-11-23', time: '19:17' },
    { ...valid, date: '2026-11-20', time: '12:00' },
    { ...valid, date: '2026-11-19' },
    { ...valid, partySize: 21 },
    { ...valid, coupon: 'x' },
  ])('same result as the BOOK-001 rules for %j', (body) => {
    expect(parseBookingSubmission(body, off)).toEqual(parseBookingSubmission(body, base))
  })
})
