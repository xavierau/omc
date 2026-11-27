/**
 * BOOK-014: an amount of money in integer minor units (cents for HKD), with
 * its ISO 4217 currency in upper case. Integer math only: no floats ever hold
 * an amount (R53). The commerce ADR's `Money`, as a plain value.
 */
export interface Money {
  readonly amountMinor: number
  readonly currency: string
}

const CURRENCY = /^[A-Z]{3}$/

/** Currencies with no minor unit (Stripe's zero-decimal list, the ones a region here could use). */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'PYG', 'UGX', 'XAF', 'XOF'])

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidMoneyError'
  }
}

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && CURRENCY.test(value)
}

/** Throws InvalidMoneyError unless the amount is a safe non-negative integer and the currency an ISO code. */
export function money(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new InvalidMoneyError('amount must be a non-negative integer')
  const code = currency.toUpperCase()
  if (!CURRENCY.test(code)) throw new InvalidMoneyError('currency must be a 3-letter ISO code')
  return { amountMinor, currency: code }
}

export function minorUnitDigits(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2
}

/** Whole currency units (HK$300) to Money (30000 minor). */
export function fromWholeUnits(units: number, currency: string): Money {
  if (!Number.isSafeInteger(units) || units < 0) throw new InvalidMoneyError('units must be a non-negative integer')
  return money(units * 10 ** minorUnitDigits(currency), currency)
}

export function multiply(m: Money, factor: number): Money {
  if (!Number.isSafeInteger(factor) || factor < 0) throw new InvalidMoneyError('factor must be a non-negative integer')
  return money(m.amountMinor * factor, m.currency)
}

export function minMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new InvalidMoneyError('currencies differ')
  return a.amountMinor <= b.amountMinor ? a : b
}

export function sameMoney(a: Money, b: Money): boolean {
  return a.amountMinor === b.amountMinor && a.currency === b.currency
}

/** "HK$400" / "USD 12.50": a display string for messages and logs (no locale dependence). */
export function formatMoney(m: Money): string {
  const digits = minorUnitDigits(m.currency)
  const whole = Math.floor(m.amountMinor / 10 ** digits)
  const fraction = digits === 0 ? 0 : m.amountMinor % 10 ** digits
  const amount = fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(digits, '0')}`
  return m.currency === 'HKD' ? `HK$${amount}` : `${m.currency} ${amount}`
}
