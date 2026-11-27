/**
 * BOOK-014 W3 (spec AC-3, AC-5): what a diner page needs to show the deposit
 * before submit: the stored rule's amount terms and the connected account's
 * currency. The amount for a party comes from `depositFor`, the same function
 * the server charges with (R53), so the page and the charge cannot disagree.
 * No refund note here: the terms text is W2's.
 */
import { depositFor, type DepositRule } from './deposit-rule'
import type { Money } from './money'

export interface DepositPlan {
  mode: DepositRule['mode']
  amount: number
  fromPartySize: number
  currency: string
}

export function depositPlanOf(rule: DepositRule, currency: string): DepositPlan {
  return { mode: rule.mode, amount: rule.amount, fromPartySize: rule.fromPartySize, currency }
}

/** The deposit a party of `partySize` owes under the plan; null when none (no plan, no party yet, below N). */
export function depositForPlan(plan: DepositPlan | null | undefined, partySize: number | null): Money | null {
  if (!plan || partySize === null) return null
  const rule: DepositRule = { enabled: true, mode: plan.mode, amount: plan.amount, fromPartySize: plan.fromPartySize, refundNote: { zh_hk: '', en: '' } }
  return depositFor(rule, partySize, plan.currency)
}
