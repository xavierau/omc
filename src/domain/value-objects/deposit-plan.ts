/**
 * BOOK-014 W3 (spec AC-3, AC-5): what a diner page needs to show the deposit
 * before submit: the stored rule's amount terms and the connected account's
 * currency. The amount for a party comes from `depositFor`, the same function
 * the server charges with (R53), so the page and the charge cannot disagree.
 * W6a (AC-3): `terms` is depositTermsText per language (the amount rule
 * plus the admin's refund note), the line every channel states.
 */
import { depositFor, type DepositRule } from './deposit-rule'
import { depositTermsText } from './deposit-terms'
import type { Money } from './money'

export interface DepositPlan {
  mode: DepositRule['mode']
  amount: number
  fromPartySize: number
  currency: string
  /** W6a: depositTermsText per language; null for a language it gives nothing. */
  terms?: { zh_hk: string | null; en: string | null }
}

export function depositPlanOf(rule: DepositRule, currency: string): DepositPlan {
  return {
    mode: rule.mode,
    amount: rule.amount,
    fromPartySize: rule.fromPartySize,
    currency,
    terms: { zh_hk: depositTermsText(rule, currency, 'zh_hk'), en: depositTermsText(rule, currency, 'en') },
  }
}

/** The deposit a party of `partySize` owes under the plan; null when none (no plan, no party yet, below N). */
export function depositForPlan(plan: DepositPlan | null | undefined, partySize: number | null): Money | null {
  if (!plan || partySize === null) return null
  const rule: DepositRule = { enabled: true, mode: plan.mode, amount: plan.amount, fromPartySize: plan.fromPartySize, refundNote: { zh_hk: '', en: '' } }
  return depositFor(rule, partySize, plan.currency)
}
