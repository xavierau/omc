import { describe, it, expect } from 'vitest'
import { hongKongToday, parseBookingSubmission } from '../booking-submission'

const rules = { today: '2026-11-12', maxPartySize: 20 }
const valid = { date: '2026-11-13', time: '19:30', partySize: 4, name: 'Chan Tai Man', notes: 'window seat' }

function errorsFor(body: unknown) {
  const result = parseBookingSubmission(body, rules)
  if (result.ok) throw new Error('expected a rejection')
  return result.errors
}

describe('hongKongToday', () => {
  it('uses Asia/Hong_Kong, not UTC (16:30 UTC is already tomorrow in HK)', () => {
    expect(hongKongToday(new Date('2026-11-12T16:30:00Z'))).toBe('2026-11-13')
    expect(hongKongToday(new Date('2026-11-12T15:59:00Z'))).toBe('2026-11-12')
  })
})

describe('parseBookingSubmission (R3 / AC-11)', () => {
  it('accepts a valid submission and trims text', () => {
    const result = parseBookingSubmission({ ...valid, name: '  Chan  ', notes: '  ' }, rules)
    expect(result).toEqual({
      ok: true,
      submission: { date: '2026-11-13', time: '19:30', partySize: 4, name: 'Chan', notes: null },
    })
  })

  it('accepts today and a numeric-string party size from a form input', () => {
    const result = parseBookingSubmission({ ...valid, date: '2026-11-12', partySize: '20' }, rules)
    expect(result.ok && result.submission.partySize).toBe(20)
  })

  it.each([
    ['past date', { date: '2026-11-11' }, 'date', 'past'],
    ['impossible date', { date: '2026-02-30' }, 'date', 'invalid'],
    ['bad time', { time: '25:00' }, 'time', 'invalid'],
    ['time without leading zero', { time: '7:30' }, 'time', 'invalid'],
    ['party size 0', { partySize: 0 }, 'partySize', 'too_small'],
    ['party size above max', { partySize: 21 }, 'partySize', 'too_large'],
    ['party size not an integer', { partySize: 2.5 }, 'partySize', 'invalid'],
    ['name over 60 chars', { name: 'n'.repeat(61) }, 'name', 'too_long'],
    ['notes over 500 chars', { notes: 'x'.repeat(501) }, 'notes', 'too_long'],
  ])('rejects %s on its field', (_label, patch, field, code) => {
    expect(errorsFor({ ...valid, ...patch })).toEqual({ [field]: code })
  })

  it.each(['date', 'time', 'partySize', 'name'])('rejects a missing %s as required', (field) => {
    const body: Record<string, unknown> = { ...valid }
    delete body[field]
    expect(errorsFor(body)).toEqual({ [field]: 'required' })
  })

  it('counts name length in characters, as Postgres does (60 CJK chars pass)', () => {
    expect(parseBookingSubmission({ ...valid, name: '陳'.repeat(60) }, rules).ok).toBe(true)
  })

  it('rejects an unknown field', () => {
    expect(errorsFor({ ...valid, isVip: true })).toEqual({ isVip: 'unknown_field' })
  })

  it('ignores identity fields instead of trusting them (R2)', () => {
    const result = parseBookingSubmission(
      { ...valid, restaurantId: 'other', phone: '+85299999999', slug: 'other', token: 'x' },
      rules
    )
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain('+85299999999')
  })

  it.each([null, 'text', [1]])('rejects a non-object body %j', (body) => {
    expect(errorsFor(body)).toEqual({ form: 'invalid_body' })
  })

  it('respects the restaurant maximum', () => {
    const result = parseBookingSubmission({ ...valid, partySize: 8 }, { ...rules, maxPartySize: 6 })
    expect(result).toEqual({ ok: false, errors: { partySize: 'too_large' } })
  })
})
