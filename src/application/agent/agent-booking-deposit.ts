/**
 * BOOK-014 W5 (spec AC-9, Q5, Explicitly Not Handled; threat R53, R54, R59,
 * R61, R64): deposits on the WhatsApp AI agent's booking tools.
 *
 * - create: when the restaurant's rule applies to the party, the agreed
 *   booking goes through W1's `startDeposit` (the one money entry of every
 *   channel), diner hold (30 minutes), with the atomic booking + deposit
 *   insert (seat check and per-phone cap in the same transaction, R55). The
 *   diner gets the payment link text right away (amount, pay-by time, the
 *   /p link, the refund rule, R61), and the model gets only the amount, the
 *   pay-by time and the link to relay. Paid -> pending + "received" (the
 *   payment webhook's hook); lapse -> lapsed (expireDeposits).
 * - payment unavailable (provider down, account not Active): startDeposit
 *   already released the hold; the model gets a fixed answer (R64).
 * - change: refused for a booking with a deposit in any state but lapsed; the
 *   diner is handed to staff (a deposit is never orphaned on a replaced row).
 * - cancel: allowed; with a paid deposit the diner is told the restaurant
 *   decides, quoting the admin's rule (Q5); staff then Refund / Keep (W4).
 * - R59: no tool takes a deposit, amount, waiver, refund or payment field;
 *   a call that sends one is refused before anything runs.
 * - W6-fix F5: propose stores the deposit it read back (or none); create
 *   recomputes it from the same account read startDeposit then uses and, if
 *   it differs, books nothing, charges nothing and re-proposes
 *   (`terms_changed`). A deposit is never charged or skipped silently.
 */
import { MAX_PENDING_PER_PHONE, type NewBookingRequest } from '@/domain/entities/booking-request'
import type { BookingDeposit } from '@/domain/entities/booking-deposit'
import type { AgentToolOutput } from '@/domain/ports/agent-model'
import { hongKongTime } from '@/domain/services/booking-submission'
import { sanitizeTemplateParam } from '@/domain/services/booking-message'
import { withDisclosure } from '@/domain/services/agent-reply-text'
import { depositTermsText } from '@/domain/value-objects/deposit-terms'
import { DEPOSIT_RULE_OFF, type DepositRule } from '@/domain/value-objects/deposit-rule'
import { depositDecisionText, depositLinkText } from '@/domain/value-objects/deposit-messages'
import { formatMoney, sameMoney, type Money } from '@/domain/value-objects/money'
import { DINER_HOLD_MS } from '@/domain/entities/booking-deposit'
import { plannedDeposit, startDeposit } from '@/application/payments/start-deposit'
import { TOO_MANY_PENDING, type BookingCall } from './agent-booking-gate'
import { depositInsertCheck } from './agent-booking-rules'

/** R59: a tool argument that names money or payment is refused (no tool declares one). */
const PAYMENT_ARG = /deposit|amount|waiv|refund|pay|paid|price|currency|charge/i

export function refusePaymentArgs(args: Record<string, unknown>): AgentToolOutput | null {
  const bad = Object.keys(args).filter((k) => PAYMENT_ARG.test(k))
  if (bad.length === 0) return null
  return {
    error: 'invalid',
    fields: Object.fromEntries(bad.map((k) => [k, 'not_allowed'])),
    note: 'Deposits and payments are set by the restaurant and cannot be changed in chat. Call the tool again without that field.',
  }
}

export const PAYMENT_UNAVAILABLE: AgentToolOutput = {
  error: 'payment_unavailable',
  note: 'The deposit payment is unavailable right now, so nothing was booked. Tell the diner payment is unavailable right now and to message the restaurant.',
}

/** Spec Explicitly Not Handled: a fixed refusal, no provider detail. */
export const DEPOSIT_NOT_CHANGEABLE: AgentToolOutput = {
  error: 'deposit_booking',
  note: 'This booking has a deposit, so it cannot be changed in chat. Tell the diner the restaurant staff will help them change it, and offer handoff_to_staff if you have it.',
}

const ruleOf = (call: BookingCall): DepositRule => call.booking.config.deposit ?? DEPOSIT_RULE_OFF
/** Skips the account read when the rule cannot apply to this party. */
const mayApply = (rule: DepositRule, partySize: number) => rule.enabled && partySize >= rule.fromPartySize

function termsOf(rule: DepositRule, amount: Money) {
  return { zh_hk: depositTermsText(rule, amount.currency, 'zh_hk'), en: depositTermsText(rule, amount.currency, 'en') }
}

/** The deposit this party would pay now, or null (no deposits wired, rule off or below N, account not chargeable). */
async function planFor(call: BookingCall, partySize: number): Promise<Money | null> {
  const deposit = call.booking.deposit
  const rule = ruleOf(call)
  if (!deposit || !mayApply(rule, partySize)) return null
  return plannedDeposit(rule, await deposit.accounts.findForRestaurant(call.key.restaurantId), partySize)
}

/** What a proposal stores of its deposit (F5). */
export type PlannedDeposit = { amountMinor: number; currency: string } | null

export function samePlan(a: PlannedDeposit, b: Money | null): boolean {
  return a === null || b === null ? a === b : sameMoney({ amountMinor: a.amountMinor, currency: a.currency }, b)
}

/** The read-back of one planned deposit: the amount and the rule, so the diner agrees knowing a deposit is needed. */
export function depositReadBack(call: BookingCall, amount: Money | null): { deposit?: AgentToolOutput; note?: string } {
  if (!amount) return {}
  const terms = termsOf(ruleOf(call), amount)
  const minutes = DINER_HOLD_MS / 60_000
  return {
    deposit: { amount: formatMoney(amount), payWithinMinutes: minutes, ...(terms.en ? { terms: terms.en } : {}) },
    note: `This booking needs a deposit of ${formatMoney(amount)}: tell the diner, with the deposit terms. Once they agree, they get a payment link and have ${minutes} minutes to pay; the request goes to the restaurant only after payment.`,
  }
}

/** propose_booking's read-back plus the plan the proposal stores (F5). */
export async function proposalDeposit(
  call: BookingCall,
  partySize: number
): Promise<{ plan: PlannedDeposit; deposit?: AgentToolOutput; note?: string }> {
  const amount = await planFor(call, partySize)
  return { plan: amount ? { amountMinor: amount.amountMinor, currency: amount.currency } : null, ...depositReadBack(call, amount) }
}

/** create_booking_request: held with its deposit (`output`), booked the AGENT-003 way (`no_deposit`), or the plan changed (F5). */
export type CreateWithDepositResult =
  | { kind: 'output'; output: AgentToolOutput }
  | { kind: 'no_deposit' }
  | { kind: 'terms_changed'; plan: Money | null }

/**
 * Spec AC-9: the agreed booking with its deposit, or `no_deposit` when no
 * deposit applies (the caller books the AGENT-003 way). F5: `agreed` is the
 * plan the diner agreed to (undefined = a proposal from before W6-fix, not
 * checked); a different plan now is `terms_changed` and nothing is written.
 */
export async function createWithDeposit(
  call: BookingCall,
  request: NewBookingRequest,
  agreed?: PlannedDeposit
): Promise<CreateWithDepositResult> {
  const deposit = call.booking.deposit
  const rule = ruleOf(call)
  const wired = deposit && mayApply(rule, request.partySize) ? deposit : null
  const { key, booking } = call
  const [account, restaurant] = wired
    ? await Promise.all([wired.accounts.findForRestaurant(key.restaurantId), booking.settings.getRestaurant(key.restaurantId)])
    : [null, null]
  // F5: the same account read startDeposit uses below, so the plan checked is the plan charged.
  const plan = wired ? plannedDeposit(rule, account, request.partySize) : null
  if (agreed !== undefined && !samePlan(agreed, plan)) return { kind: 'terms_changed', plan }
  if (!wired) return { kind: 'no_deposit' }
  const insert = depositInsertCheck(call, request)
  const restaurantName = sanitizeTemplateParam(restaurant?.name)
  const started = await startDeposit(wired.start, {
    restaurantId: key.restaurantId,
    rule,
    account,
    partySize: request.partySize,
    holder: 'diner',
    restaurantName,
    bookingDate: request.bookingDate,
    bookingTime: request.bookingTime,
    // R55: the seat check and the per-phone cap in the same transaction as the hold.
    insertBooking: (hold) => wired.writer.insertWithDeposit(request, insert.check, hold, MAX_PENDING_PER_PHONE),
  })
  switch (started.kind) {
    case 'not_required':
      return { kind: 'no_deposit' }
    case 'payment_unavailable':
      return { kind: 'output', output: PAYMENT_UNAVAILABLE }
    case 'refused':
      return { kind: 'output', output: started.refusal.kind === 'pending_cap' ? TOO_MANY_PENDING : await insert.full(started.refusal) }
    case 'started':
      break
  }
  const payBy = hongKongTime(new Date(started.expiresAt))
  const text = depositLinkText({
    restaurantName,
    amount: started.amount,
    payBy,
    paymentUrl: started.paymentUrl,
    booking: { date: request.bookingDate, time: request.bookingTime, partySize: request.partySize },
    terms: termsOf(rule, started.amount),
  })
  // R11: an agent-sent text carries the tenant's disclosure; best effort, the model relays the link otherwise.
  const texted = await booking.notifyText(key.restaurantId, key.phone, withDisclosure(text, booking.disclosureText)).catch(() => false)
  const output: AgentToolOutput = {
    booked: true,
    status: 'awaiting_deposit',
    deposit: { amount: formatMoney(started.amount), payBy, paymentUrl: started.paymentUrl },
    note: texted
      ? `The booking is held until ${payBy} and the diner already got the payment link in a text. Reply briefly: they must pay the ${formatMoney(started.amount)} deposit by ${payBy}, then the request goes to the restaurant, which confirms it by WhatsApp.`
      : `The booking is held until ${payBy}. Give the diner the paymentUrl exactly as it is and tell them to pay the ${formatMoney(started.amount)} deposit by ${payBy}; then the request goes to the restaurant, which confirms it by WhatsApp.`,
  }
  return { kind: 'output', output }
}

/** The booking's deposit (scoped by restaurant), or null when deposits are not wired or there is none. */
async function depositOf(call: BookingCall, bookingId: string): Promise<BookingDeposit | null> {
  const deposit = call.booking.deposit
  return deposit ? deposit.deposits.findByBookingForRestaurant(call.key.restaurantId, bookingId) : null
}

/** Spec Explicitly Not Handled: any deposit but a lapsed one blocks a change by chat. */
export async function depositBlocksChange(call: BookingCall, bookingId: string): Promise<boolean> {
  const deposit = await depositOf(call, bookingId)
  return deposit !== null && deposit.status !== 'lapsed'
}

/** Q5: the "restaurant decides" text for a booking whose deposit is paid; null otherwise. */
export async function paidDepositNote(call: BookingCall, bookingId: string): Promise<string | null> {
  const deposit = await depositOf(call, bookingId)
  if (!deposit || deposit.status !== 'paid') return null
  return depositDecisionText(deposit.amount, termsOf(ruleOf(call), deposit.amount))
}
