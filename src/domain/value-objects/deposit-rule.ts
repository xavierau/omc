/**
 * BOOK-014 (spec S2, AC-3; threat R53): a restaurant's deposit rule, stored in
 * `booking_config.deposit`. W2 owns the admin form and its save; this module
 * owns the vocabulary, the validation and the amount.
 *
 * The amount is computed here, on the server, from the stored rule and the
 * party size; no route, tool or form takes an amount (R53).
 */
import { fromWholeUnits, minMoney, multiply, type Money } from './money'

export type DepositMode = 'per_guest' | 'per_booking'

export interface DepositRefundNote {
  zh_hk: string
  en: string
}

export interface DepositRule {
  enabled: boolean
  mode: DepositMode
  /** Whole currency units (HK$300 = 300), the account's currency. */
  amount: number
  /** The deposit applies to parties of this size or more. */
  fromPartySize: number
  refundNote: DepositRefundNote
}

/** R53: the provider's smallest charge (HK$4) and our per-booking cap, in whole units. */
export const DEPOSIT_MIN_WHOLE = 4
export const DEPOSIT_MAX_WHOLE = 10_000
export const DEPOSIT_PARTY_MIN = 1
export const DEPOSIT_PARTY_MAX = 1000
export const DEPOSIT_REFUND_NOTE_MAX = 500

export const DEPOSIT_RULE_OFF: DepositRule = {
  enabled: false,
  mode: 'per_guest',
  amount: 0,
  fromPartySize: 1,
  refundNote: { zh_hk: '', en: '' },
}

export type DepositRuleField = 'enabled' | 'mode' | 'amount' | 'fromPartySize' | 'refundNote'
export type DepositRuleParse = { ok: true; rule: DepositRule } | { ok: false; errors: DepositRuleField[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isWhole = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max
const isNote = (v: unknown): v is string => typeof v === 'string' && [...v].length <= DEPOSIT_REFUND_NOTE_MAX

/**
 * Strict: an admin's save (W2) or a stored value. An enabled rule needs an
 * amount within HK$4..HK$10,000 and a party size within 1..1000; a disabled
 * one may carry any well-typed draft values.
 */
export function validateDepositRule(raw: unknown): DepositRuleParse {
  if (!isRecord(raw)) return { ok: false, errors: ['enabled'] }
  const errors: DepositRuleField[] = []
  const enabled = raw.enabled
  if (typeof enabled !== 'boolean') errors.push('enabled')
  const mode = raw.mode
  if (mode !== 'per_guest' && mode !== 'per_booking') errors.push('mode')
  const amount = raw.amount
  if (!isWhole(amount, enabled === true ? DEPOSIT_MIN_WHOLE : 0, DEPOSIT_MAX_WHOLE)) errors.push('amount')
  const from = raw.fromPartySize
  if (!isWhole(from, DEPOSIT_PARTY_MIN, DEPOSIT_PARTY_MAX)) errors.push('fromPartySize')
  const note = raw.refundNote
  if (!isRecord(note) || !isNote(note.zh_hk) || !isNote(note.en)) errors.push('refundNote')
  if (errors.length > 0) return { ok: false, errors }
  const n = note as Record<string, string>
  return {
    ok: true,
    rule: {
      enabled: enabled as boolean,
      mode: mode as DepositMode,
      amount: amount as number,
      fromPartySize: from as number,
      refundNote: { zh_hk: n.zh_hk.trim(), en: n.en.trim() },
    },
  }
}

/** Tolerant read of a stored rule: anything malformed is OFF (no deposit), never a guessed amount. */
export function resolveDepositRule(raw: unknown): DepositRule {
  const parsed = validateDepositRule(raw)
  return parsed.ok ? parsed.rule : DEPOSIT_RULE_OFF
}

/**
 * The deposit a party of `partySize` owes, in `currency` (the account's), or
 * null when none applies (rule off, party below N). Per guest = amount × party;
 * per booking = amount. Capped at HK$10,000-equivalent whole units per booking.
 */
export function depositFor(rule: DepositRule, partySize: number, currency: string): Money | null {
  if (!rule.enabled || !Number.isSafeInteger(partySize) || partySize < rule.fromPartySize) return null
  if (!isWhole(rule.amount, DEPOSIT_MIN_WHOLE, DEPOSIT_MAX_WHOLE)) return null
  const unit = fromWholeUnits(rule.amount, currency)
  const total = rule.mode === 'per_guest' ? multiply(unit, partySize) : unit
  return minMoney(total, fromWholeUnits(DEPOSIT_MAX_WHOLE, currency))
}
