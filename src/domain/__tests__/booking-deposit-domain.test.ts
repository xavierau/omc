// BOOK-014 W1 domain: Money, the deposit rule and its amount (R53), the
// deposit transition table (R56, R57) and the /p link token (R62).
import { describe, it, expect } from 'vitest'
import { InvalidMoneyError, formatMoney, fromWholeUnits, money, multiply, sameMoney } from '@/domain/value-objects/money'
import { DEPOSIT_RULE_OFF, depositFor, resolveDepositRule, validateDepositRule, type DepositRule } from '@/domain/value-objects/deposit-rule'
import { DEPOSIT_TRANSITIONS, canTransition, holdMsFor, refundIdempotencyKey, type DepositStatus } from '@/domain/entities/booking-deposit'
import { isChargeable } from '@/domain/entities/merchant-payment-account'
import { hashPaymentLinkToken, isPaymentLinkTokenShape, mintPaymentLinkToken } from '@/domain/services/payment-link-token'

const rule = (over: Partial<DepositRule> = {}): DepositRule => ({
  enabled: true, mode: 'per_guest', amount: 100, fromPartySize: 1, refundNote: { zh_hk: '', en: '' }, ...over,
})

describe('Money (integer minor units)', () => {
  it('whole units to minor, per currency digits', () => {
    expect(fromWholeUnits(300, 'HKD')).toEqual({ amountMinor: 30000, currency: 'HKD' })
    expect(fromWholeUnits(300, 'jpy')).toEqual({ amountMinor: 300, currency: 'JPY' })
  })
  it('refuses floats, negatives and bad currencies', () => {
    expect(() => money(1.5, 'HKD')).toThrow(InvalidMoneyError)
    expect(() => money(-1, 'HKD')).toThrow(InvalidMoneyError)
    expect(() => money(1, 'HK')).toThrow(InvalidMoneyError)
    expect(() => multiply(money(100, 'HKD'), 1.5)).toThrow(InvalidMoneyError)
  })
  it('compares and formats', () => {
    expect(sameMoney(money(100, 'hkd'), money(100, 'HKD'))).toBe(true)
    expect(sameMoney(money(100, 'HKD'), money(100, 'USD'))).toBe(false)
    expect(formatMoney(money(40000, 'HKD'))).toBe('HK$400')
    expect(formatMoney(money(1250, 'USD'))).toBe('USD 12.50')
  })
})

describe('R53: the deposit amount is computed on the server from the stored rule', () => {
  it('per guest 100 × 8 -> 80000 minor; flat 300 -> 30000', () => {
    expect(depositFor(rule({ amount: 100 }), 8, 'HKD')).toEqual({ amountMinor: 80000, currency: 'HKD' })
    expect(depositFor(rule({ mode: 'per_booking', amount: 300 }), 8, 'HKD')).toEqual({ amountMinor: 30000, currency: 'HKD' })
  })
  it('none when off or below "from party size N"', () => {
    expect(depositFor(DEPOSIT_RULE_OFF, 8, 'HKD')).toBeNull()
    expect(depositFor(rule({ fromPartySize: 6 }), 5, 'HKD')).toBeNull()
    expect(depositFor(rule({ fromPartySize: 6 }), 6, 'HKD')).not.toBeNull()
  })
  it('per guest is capped at HK$10,000 per booking', () => {
    expect(depositFor(rule({ amount: 500 }), 40, 'HKD')).toEqual({ amountMinor: 1_000_000, currency: 'HKD' })
  })
  it('validation: whole units, ≥ HK$4, ≤ HK$10,000 (cap exceeded -> rejected), N 1..1000, note ≤ 500', () => {
    expect(validateDepositRule(rule()).ok).toBe(true)
    expect(validateDepositRule(rule({ amount: 10_001 }))).toEqual({ ok: false, errors: ['amount'] })
    expect(validateDepositRule(rule({ amount: 3 }))).toEqual({ ok: false, errors: ['amount'] })
    expect(validateDepositRule(rule({ amount: 99.5 }))).toEqual({ ok: false, errors: ['amount'] })
    expect(validateDepositRule(rule({ fromPartySize: 0 }))).toEqual({ ok: false, errors: ['fromPartySize'] })
    expect(validateDepositRule(rule({ refundNote: { zh_hk: 'x'.repeat(501), en: '' } }))).toEqual({ ok: false, errors: ['refundNote'] })
    expect(validateDepositRule(rule({ enabled: false, amount: 0 })).ok).toBe(true)
  })
  it('a malformed stored rule reads as OFF, never a guessed amount', () => {
    expect(resolveDepositRule({ enabled: true, mode: 'per_guest', amount: '100' })).toEqual(DEPOSIT_RULE_OFF)
    expect(resolveDepositRule(null)).toEqual(DEPOSIT_RULE_OFF)
  })
})

describe('deposit transitions (R56, R57)', () => {
  it('the table the SQL follows', () => {
    const ok: Array<[DepositStatus, DepositStatus]> = [
      ['awaiting', 'paid'], ['awaiting', 'lapsed'], ['lapsed', 'refund_pending'], ['paid', 'refund_pending'], ['paid', 'kept'],
      ['refund_pending', 'refunded'], ['refund_pending', 'refund_failed'], ['refund_failed', 'refund_pending'], ['refund_failed', 'refunded'],
    ]
    for (const [a, b] of ok) expect(canTransition(a, b), `${a}->${b}`).toBe(true)
    expect(canTransition('kept', 'refund_pending')).toBe(false)
    expect(canTransition('refunded', 'kept')).toBe(false)
    expect(canTransition('lapsed', 'paid')).toBe(false)
    expect(DEPOSIT_TRANSITIONS.kept).toEqual([])
  })
  it('holds: 30 min diner, 24 h minus 2 min staff (inside one Checkout Session, review finding 5); refund key per attempt', () => {
    expect(holdMsFor('diner')).toBe(30 * 60_000)
    expect(holdMsFor('staff')).toBe(24 * 3_600_000 - 2 * 60_000)
    expect(refundIdempotencyKey('d1', 2)).toBe('refund:d1:2')
  })
  it('AC-4: only an active, charge-enabled account with an id and a currency takes deposits', () => {
    const base = { id: 'a', restaurantId: 'r', providerCode: 'test' as const, providerAccountId: 'acct', status: 'active' as const, chargesEnabled: true, currency: 'HKD', restrictionReason: null }
    expect(isChargeable(base)).toBe(true)
    expect(isChargeable({ ...base, status: 'restricted' })).toBe(false)
    expect(isChargeable({ ...base, chargesEnabled: false })).toBe(false)
    expect(isChargeable({ ...base, currency: null })).toBe(false)
    expect(isChargeable(null)).toBe(false)
  })
})

describe('R62: payment link token', () => {
  it('32 random bytes base64url (43 chars), stored as its sha256 hex only', () => {
    const { token, hash } = mintPaymentLinkToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(hashPaymentLinkToken(token))
    expect(hash).not.toContain(token)
    expect(mintPaymentLinkToken().token).not.toBe(token)
  })
  it('short or odd tokens are not token-shaped', () => {
    expect(isPaymentLinkTokenShape('abc')).toBe(false)
    expect(isPaymentLinkTokenShape('A'.repeat(42))).toBe(false)
    expect(isPaymentLinkTokenShape(`${'A'.repeat(42)}/`)).toBe(false)
    expect(isPaymentLinkTokenShape('A'.repeat(43))).toBe(true)
  })
})
