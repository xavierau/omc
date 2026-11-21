// BOOK-009 AC-2 / AC-5 (plan D1): booking_config.bookingHours resolves field
// by field (malformed → null) and an admin save is validated per path.
import { describe, it, expect } from 'vitest'
import {
  applyBookingSettings,
  DEFAULT_BOOKING_CONFIG,
  parseBookingSettings,
  resolveBookingConfig,
  type BookingConfig,
} from '../booking-config'
import { resolveBookingHours, termsRequired, termsSnapshot, withoutPastSpecialDates, type BookingHours } from '../booking-hours'

const TODAY = '2026-11-20'
const OPEN = [{ label: '午市', first: '12:00', last: '14:00' }, { first: '18:00', last: '21:30' }]
const HOURS: BookingHours = {
  scheduleEnabled: true,
  weekly: { mon: [], tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN, sun: OPEN },
  intervalMinutes: 30,
  noticeHours: 2,
  aheadDays: 30,
  special: [{ date: '2026-12-25', label: '聖誕', periods: [] }],
  tableMinutes: 120,
  terms: { zh_hk: '請準時到達', en: 'Please arrive on time' },
  info: { address: '1 Queen St', phone: '+852 2345 6789', mapUrl: 'https://maps.example/x' },
}
const current: BookingConfig = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple', bookingRules: 'notes', aiRoutingEnabled: true }

function save(bookingHours: unknown, today = TODAY) {
  return parseBookingSettings({ mode: 'simple', bookingHours }, current, today)
}
function errorsOf(bookingHours: unknown) {
  const result = save(bookingHours)
  if (result.ok) throw new Error('expected a rejection')
  return result.errors
}
const withDay = (tue: unknown) => ({ ...HOURS, weekly: { ...HOURS.weekly, tue } })

describe('resolveBookingConfig bookingHours (AC-5)', () => {
  it('is null by default and for every tenant that never set it', () => {
    expect(DEFAULT_BOOKING_CONFIG.bookingHours).toBeNull()
    expect(resolveBookingConfig(undefined).bookingHours).toBeNull()
    expect(resolveBookingConfig({ mode: 'simple', maxPartySize: 8 }).bookingHours).toBeNull()
  })

  it('round-trips a stored value', () => {
    expect(resolveBookingConfig({ mode: 'simple', bookingHours: HOURS }).bookingHours).toEqual(HOURS)
  })

  it.each([
    ['a string', 'Tue-Sun 12-14'],
    ['an array', [OPEN]],
    ['no weekly table', { intervalMinutes: 30 }],
    ['a period with a bad time', withDay([{ first: '12:00', last: '25:00' }])],
    ['a day that is not a list', withDay('12:00-14:00')],
  ])('malformed stored JSON (%s) resolves to null, never throws', (_label, raw) => {
    expect(resolveBookingConfig({ mode: 'simple', bookingHours: raw }).bookingHours).toBeNull()
    expect(resolveBookingHours(raw)).toBeNull()
  })

  it('resolves other fields one by one: bad options to defaults, bad specials dropped, missing days closed', () => {
    const resolved = resolveBookingHours({
      weekly: { tue: OPEN },
      intervalMinutes: 20,
      noticeHours: 5,
      aheadDays: 365,
      tableMinutes: 100,
      special: [{ date: '2026-02-30', periods: [] }, { date: '2026-12-25', periods: [] }, 'x'],
      terms: { zh_hk: 42, en: '  Be on time ' },
      info: null,
    })
    expect(resolved).toEqual({
      // F1: no stored switch + a Tuesday period → on
      scheduleEnabled: true,
      weekly: { mon: [], tue: OPEN, wed: [], thu: [], fri: [], sat: [], sun: [] },
      intervalMinutes: 30,
      noticeHours: 2,
      aheadDays: 30,
      special: [{ date: '2026-12-25', periods: [] }],
      tableMinutes: null,
      terms: { zh_hk: '', en: 'Be on time' },
      info: { address: '', phone: '', mapUrl: '' },
    })
  })
})

describe('parseBookingSettings bookingHours (AC-1, AC-2)', () => {
  it('AC-1: saves the hours and keeps every field the form does not own', () => {
    const result = save(HOURS)
    expect(result).toEqual({ ok: true, config: { ...current, bookingHours: HOURS } })
  })

  it('omitted keeps the stored hours; null turns them off', () => {
    const stored = { ...current, bookingHours: HOURS }
    const kept = parseBookingSettings({ mode: 'simple' }, stored, TODAY)
    expect(kept.ok && kept.config.bookingHours).toEqual(HOURS)
    const off = parseBookingSettings({ mode: 'simple', bookingHours: null }, stored, TODAY)
    expect(off.ok && off.config.bookingHours).toBeNull()
  })

  it('trims text and drops empty labels', () => {
    const result = save({ ...withDay([{ label: ' ', first: '12:00', last: '14:00' }]), terms: { zh_hk: ' 須知 ', en: '' } })
    expect(result.ok && result.config.bookingHours?.weekly.tue).toEqual([{ first: '12:00', last: '14:00' }])
    expect(result.ok && result.config.bookingHours?.terms).toEqual({ zh_hk: '須知', en: '' })
  })

  it('AC-2: each bad field gets its own error keyed by path, and nothing is saved', () => {
    const errors = errorsOf({
      ...HOURS,
      weekly: {
        ...HOURS.weekly,
        wed: [{ first: '14:00', last: '12:00' }],
        thu: [{ first: '12:00', last: '14:00' }, { first: '13:30', last: '15:00' }],
      },
      special: [{ date: '2026-11-19', periods: [] }],
      terms: { zh_hk: '', en: 'x'.repeat(1001) },
      info: { address: '', phone: '', mapUrl: 'http://maps.example/x' },
    })
    expect(errors).toEqual({
      'bookingHours.weekly.wed.0': 'last_before_first',
      'bookingHours.weekly.thu.1': 'overlap',
      'bookingHours.special.2026-11-19': 'past',
      'bookingHours.terms.en': 'too_long',
      'bookingHours.info.mapUrl': 'invalid_https_url',
    })
  })

  it.each([
    ['a time after 23:45', withDay([{ first: '23:00', last: '23:50' }]), { 'bookingHours.weekly.tue.0': 'invalid_time' }],
    ['a time that is not HH:MM', withDay([{ first: '7pm', last: '21:00' }]), { 'bookingHours.weekly.tue.0': 'invalid_time' }],
    ['periods sharing a booking time', withDay([{ first: '12:00', last: '14:00' }, { first: '14:00', last: '15:00' }]), { 'bookingHours.weekly.tue.1': 'overlap' }],
    ['a label over 30 chars', withDay([{ label: 'l'.repeat(31), first: '12:00', last: '14:00' }]), { 'bookingHours.weekly.tue.0': 'label_too_long' }],
    ['five periods on one day', withDay(Array.from({ length: 5 }, (_, i) => ({ first: `1${i}:00`, last: `1${i}:30` }))), { 'bookingHours.weekly.tue': 'too_many_periods' }],
    ['a day that is not a list', withDay('12:00'), { 'bookingHours.weekly.tue': 'invalid' }],
    ['no weekly table', { ...HOURS, weekly: undefined }, { 'bookingHours.weekly': 'invalid' }],
    ['interval 20', { ...HOURS, intervalMinutes: 20 }, { 'bookingHours.intervalMinutes': 'invalid' }],
    ['notice 5', { ...HOURS, noticeHours: 5 }, { 'bookingHours.noticeHours': 'invalid' }],
    ['window 365', { ...HOURS, aheadDays: 365 }, { 'bookingHours.aheadDays': 'invalid' }],
    ['table time 100', { ...HOURS, tableMinutes: 100 }, { 'bookingHours.tableMinutes': 'invalid' }],
    ['a duplicate special date', { ...HOURS, special: [{ date: '2026-12-25', periods: [] }, { date: '2026-12-25', periods: [] }] }, { 'bookingHours.special.2026-12-25': 'duplicate' }],
    ['an impossible special date', { ...HOURS, special: [{ date: '2026-02-30', periods: [] }] }, { 'bookingHours.special.0': 'invalid_date' }],
    ['a special date with overlapping periods', { ...HOURS, special: [{ date: '2026-12-24', periods: [OPEN[0], OPEN[0]] }] }, { 'bookingHours.special.2026-12-24': 'overlap' }],
    ['zh_hk terms over 1,000 chars', { ...HOURS, terms: { zh_hk: '訂'.repeat(1001), en: '' } }, { 'bookingHours.terms.zh_hk': 'too_long' }],
    ['an address over 200 chars', { ...HOURS, info: { ...HOURS.info, address: 'a'.repeat(201) } }, { 'bookingHours.info.address': 'too_long' }],
    ['a phone over 30 chars', { ...HOURS, info: { ...HOURS.info, phone: '1'.repeat(31) } }, { 'bookingHours.info.phone': 'too_long' }],
    ['an unknown key', { ...HOURS, deposit: 100 }, { bookingHours: 'unknown_field:deposit' }],
    ['a non-object', 'Tue-Sun', { bookingHours: 'invalid' }],
  ])('rejects %s', (_label, hours, expected) => {
    expect(errorsOf(hours)).toEqual(expected)
  })

  it('accepts the limits: 1,000-char terms, today as a special date, 23:45, a period of one slot', () => {
    const result = save({
      ...withDay([{ first: '23:45', last: '23:45' }]),
      special: [{ date: TODAY, periods: [] }],
      terms: { zh_hk: '訂'.repeat(1000), en: '' },
    })
    expect(result.ok).toBe(true)
  })

  it('applyBookingSettings writes bookingHours onto the stored config', () => {
    const stored = { ...current, templateIds: { ...current.templateIds, received: { en: 'tpl', zh_hk: null } } }
    expect(applyBookingSettings(stored, { ...current, bookingHours: HOURS })).toEqual({ ...stored, bookingHours: HOURS })
  })
})

describe('terms and special-date helpers', () => {
  it('terms are required when either language is set; the snapshot keeps both, zh-HK first', () => {
    expect(termsRequired(null)).toBe(false)
    expect(termsRequired({ ...HOURS, terms: { zh_hk: '', en: '' } })).toBe(false)
    expect(termsRequired({ ...HOURS, terms: { zh_hk: '', en: 'x' } })).toBe(true)
    expect(termsSnapshot(HOURS)).toBe('請準時到達\n\nPlease arrive on time')
    expect(termsSnapshot({ ...HOURS, terms: { zh_hk: '', en: 'x' } })).toBe('x')
    expect(termsSnapshot({ ...HOURS, terms: { zh_hk: '', en: '' } })).toBeNull()
  })

  it('past special dates drop out', () => {
    const h = { ...HOURS, special: [{ date: '2026-11-19', periods: [] }, { date: TODAY, periods: [] }] }
    expect(withoutPastSpecialDates(h, TODAY).special).toEqual([{ date: TODAY, periods: [] }])
  })
})
