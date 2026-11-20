// AGENT-005 AC-2: booking_config.bookingRules (訂座規則), the free-text booking
// rules the agent's booking skill checks a requested time against.
import { describe, it, expect } from 'vitest'
import {
  applyBookingSettings,
  BOOKING_RULES_MAX_CHARS,
  DEFAULT_BOOKING_CONFIG,
  parseBookingSettings,
  resolveBookingConfig,
} from '../booking-config'

const RULES = 'Bookings 12:00-20:00. Last booking 20:00, last order 20:30. Closed Mondays.'

describe('resolveBookingConfig bookingRules', () => {
  it("a missing key, a non-string or a missing blob → ''", () => {
    expect(DEFAULT_BOOKING_CONFIG.bookingRules).toBe('')
    expect(resolveBookingConfig(undefined).bookingRules).toBe('')
    expect(resolveBookingConfig({ mode: 'simple' }).bookingRules).toBe('')
    expect(resolveBookingConfig({ mode: 'simple', bookingRules: 42 }).bookingRules).toBe('')
  })

  it('keeps a stored string, trimmed and bounded', () => {
    expect(resolveBookingConfig({ bookingRules: `  ${RULES}\n` }).bookingRules).toBe(RULES)
    expect(resolveBookingConfig({ bookingRules: 'x'.repeat(BOOKING_RULES_MAX_CHARS + 10) }).bookingRules).toHaveLength(BOOKING_RULES_MAX_CHARS)
  })
})

describe('parseBookingSettings bookingRules', () => {
  const current = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple' as const, bookingRules: 'old rules' }

  it('saves a trimmed string', () => {
    const result = parseBookingSettings({ mode: 'simple', bookingRules: `\n ${RULES}  ` }, current)
    expect(result).toEqual({ ok: true, config: { ...current, bookingRules: RULES } })
  })

  it('an omitted field keeps the stored rules; an empty string clears them', () => {
    const kept = parseBookingSettings({ mode: 'simple' }, current)
    expect(kept.ok && kept.config.bookingRules).toBe('old rules')
    const cleared = parseBookingSettings({ mode: 'simple', bookingRules: '   ' }, current)
    expect(cleared.ok && cleared.config.bookingRules).toBe('')
  })

  it(`exactly ${BOOKING_RULES_MAX_CHARS} characters (after trimming) is accepted`, () => {
    const max = '訂'.repeat(BOOKING_RULES_MAX_CHARS)
    const result = parseBookingSettings({ mode: 'simple', bookingRules: ` ${max} ` }, current)
    expect(result.ok && result.config.bookingRules).toBe(max)
  })

  it(`more than ${BOOKING_RULES_MAX_CHARS} characters → a field error and no config`, () => {
    const result = parseBookingSettings({ mode: 'simple', bookingRules: 'x'.repeat(BOOKING_RULES_MAX_CHARS + 1) }, current)
    expect(result).toEqual({ ok: false, errors: { bookingRules: 'too_long' } })
  })

  it('a non-string → a field error', () => {
    expect(parseBookingSettings({ mode: 'simple', bookingRules: 5 }, current)).toEqual({ ok: false, errors: { bookingRules: 'invalid' } })
  })
})

describe('applyBookingSettings bookingRules (the CAS write applies it onto the stored config)', () => {
  it('writes the form\'s rules onto the fresh stored value and keeps fields the form does not own', () => {
    const settings = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple' as const, bookingRules: RULES }
    const stored = { ...DEFAULT_BOOKING_CONFIG, aiRoutingEnabled: true, bookingRules: 'stale' }
    const next = applyBookingSettings(stored, settings)
    expect(next.bookingRules).toBe(RULES)
    expect(next.aiRoutingEnabled).toBe(true)
  })

  it('round-trips: parse → apply → stored JSON → resolve gives the same rules', () => {
    const parsed = parseBookingSettings({ mode: 'simple', bookingRules: RULES }, DEFAULT_BOOKING_CONFIG)
    if (!parsed.ok) throw new Error('expected ok')
    const stored = JSON.parse(JSON.stringify(applyBookingSettings(DEFAULT_BOOKING_CONFIG, parsed.config)))
    expect(resolveBookingConfig(stored).bookingRules).toBe(RULES)
  })
})
