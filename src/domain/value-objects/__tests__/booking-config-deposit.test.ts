// BOOK-014 W2 (spec S2 AC-3, AC-4; threat R53): the deposit rule rides in
// booking_config.deposit, is saved by the settings form (SETTINGS_FIELDS /
// parse / apply), and is rendered for diners and agents by ONE pure function.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BOOKING_CONFIG,
  applyBookingSettings,
  parseBookingSettings,
  resolveBookingConfig,
  type BookingConfig,
} from '@/domain/value-objects/booking-config'
import { DEPOSIT_RULE_OFF, depositFor, type DepositRule } from '@/domain/value-objects/deposit-rule'
import { depositTermsText } from '@/domain/value-objects/deposit-terms'

const RULE: DepositRule = {
  enabled: true,
  mode: 'per_guest',
  amount: 100,
  fromPartySize: 6,
  refundNote: { zh_hk: '取消須提前24小時通知。', en: 'Cancel 24 hours ahead for a refund.' },
}
const TODAY = '2026-11-27'
const current = (patch: Partial<BookingConfig> = {}): BookingConfig => ({ ...structuredClone(DEFAULT_BOOKING_CONFIG), mode: 'simple', ...patch })
const parse = (deposit: unknown, from: BookingConfig = current()) => parseBookingSettings({ mode: 'simple', deposit }, from, TODAY)

describe('booking_config.deposit: resolve', () => {
  it('a config without a deposit resolves to the OFF rule', () => {
    expect(resolveBookingConfig({ mode: 'simple' }).deposit).toEqual(DEPOSIT_RULE_OFF)
    expect(DEFAULT_BOOKING_CONFIG.deposit).toEqual(DEPOSIT_RULE_OFF)
  })

  it('a stored rule survives the round trip every booking_config writer makes', () => {
    expect(resolveBookingConfig(JSON.parse(JSON.stringify({ mode: 'simple', deposit: RULE }))).deposit).toEqual(RULE)
  })

  it('a malformed stored rule is OFF, never a guessed amount', () => {
    expect(resolveBookingConfig({ mode: 'simple', deposit: { ...RULE, amount: 99999 } }).deposit).toEqual(DEPOSIT_RULE_OFF)
    expect(resolveBookingConfig({ mode: 'simple', deposit: 'yes' }).deposit).toEqual(DEPOSIT_RULE_OFF)
  })
})

describe('booking_config.deposit: the settings save (R53)', () => {
  it('omitted keeps the stored rule', () => {
    const result = parseBookingSettings({ mode: 'simple' }, current({ deposit: RULE }), TODAY)
    expect(result.ok && result.config.deposit).toEqual(RULE)
  })

  it('a valid rule is saved, notes trimmed', () => {
    const result = parse({ ...RULE, refundNote: { zh_hk: '  不設退款 ', en: ' No refunds ' } })
    expect(result.ok && result.config.deposit).toEqual({ ...RULE, refundNote: { zh_hk: '不設退款', en: 'No refunds' } })
  })

  it('a disabled draft may carry amount 0', () => {
    const result = parse({ ...DEPOSIT_RULE_OFF })
    expect(result.ok && result.config.deposit).toEqual(DEPOSIT_RULE_OFF)
  })

  it.each([
    ['zero', { amount: 0 }, 'amount'],
    ['below the HK$4 minimum', { amount: 3 }, 'amount'],
    ['over the HK$10,000 cap', { amount: 10_001 }, 'amount'],
    ['not whole', { amount: 100.5 }, 'amount'],
    ['a string', { amount: '100' }, 'amount'],
    ['party size 0', { fromPartySize: 0 }, 'fromPartySize'],
    ['party size 1001', { fromPartySize: 1001 }, 'fromPartySize'],
    ['an unknown mode', { mode: 'per_table' }, 'mode'],
    ['a refund note over 500', { refundNote: { zh_hk: 'x'.repeat(501), en: '' } }, 'refundNote'],
    ['enabled not a boolean', { enabled: 'true' }, 'enabled'],
  ])('%s → a field error under deposit.<field>', (_label, patch, field) => {
    const result = parse({ ...RULE, ...patch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toMatchObject({ [`deposit.${field}`]: 'invalid' })
  })

  it('not an object → deposit error', () => {
    const result = parse('on')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).some((k) => k.startsWith('deposit'))).toBe(true)
  })

  it('applyBookingSettings writes the form deposit onto the stored config, keeping fields the form does not own', () => {
    const stored = current({ agentBooking: { enabled: true, publicId: 'p'.repeat(22), websiteHost: 'x.hk' } })
    const next = applyBookingSettings(stored, { ...stored, deposit: RULE, agentBooking: DEFAULT_BOOKING_CONFIG.agentBooking })
    expect(next.deposit).toEqual(RULE)
    expect(next.agentBooking.enabled).toBe(true)
  })
})

describe('deposit amount (R53)', () => {
  it('per guest 100 × 8 → 80000 minor', () => {
    expect(depositFor({ ...RULE, fromPartySize: 1 }, 8, 'HKD')).toEqual({ amountMinor: 80_000, currency: 'HKD' })
  })

  it('per booking 300 → 30000 minor', () => {
    expect(depositFor({ ...RULE, mode: 'per_booking', amount: 300, fromPartySize: 1 }, 8, 'HKD')).toEqual({ amountMinor: 30_000, currency: 'HKD' })
  })
})

describe('depositTermsText: the one deposit line diners and agents see (AC-3)', () => {
  it('per guest from 6, both languages, with the refund note', () => {
    expect(depositTermsText(RULE, 'HKD', 'zh_hk')).toBe('訂金每位 HK$100（6位或以上）。取消須提前24小時通知。')
    expect(depositTermsText(RULE, 'HKD', 'en')).toBe('Deposit HK$100 per guest for 6 or more. Cancel 24 hours ahead for a refund.')
  })

  it('per booking from 1 with no note', () => {
    const rule: DepositRule = { ...RULE, mode: 'per_booking', amount: 300, fromPartySize: 1, refundNote: { zh_hk: '', en: '' } }
    expect(depositTermsText(rule, 'HKD', 'zh_hk')).toBe('訂金每張訂座 HK$300')
    expect(depositTermsText(rule, 'HKD', 'en')).toBe('Deposit HK$300 per booking')
  })

  it('per booking from 4 guests', () => {
    const rule: DepositRule = { ...RULE, mode: 'per_booking', amount: 300, fromPartySize: 4, refundNote: { zh_hk: '', en: '' } }
    expect(depositTermsText(rule, 'HKD', 'zh_hk')).toBe('訂金每張訂座 HK$300（4位或以上）')
    expect(depositTermsText(rule, 'HKD', 'en')).toBe('Deposit HK$300 per booking for 4 or more guests')
  })

  it('a note in one language only shows in that language', () => {
    const rule: DepositRule = { ...RULE, refundNote: { zh_hk: '不設退款', en: '' } }
    expect(depositTermsText(rule, 'HKD', 'en')).toBe('Deposit HK$100 per guest for 6 or more')
  })

  it('off or malformed → null (nothing to show)', () => {
    expect(depositTermsText(DEPOSIT_RULE_OFF, 'HKD', 'en')).toBeNull()
    expect(depositTermsText({ ...RULE, amount: 2 }, 'HKD', 'en')).toBeNull()
  })
})
