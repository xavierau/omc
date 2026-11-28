/**
 * BOOK-014 W5 (spec AC-10; threat R54, R55, R61, R64): the confirm-code step
 * of a personal agent's booking when the restaurant asks a deposit.
 *
 * The create step is unchanged (unverified + confirm code). When the diner's
 * code arrives, each candidate the rule applies to goes through W1's
 * `startDeposit` (diner hold, 30 minutes) with the one-row promotion
 * `promoteToDeposit` as its insert: unverified -> awaiting_deposit + the
 * deposit, one transaction, under the promotion's lock, cap and seat check.
 * The diner then gets the payment link in that WhatsApp chat (amount, pay-by
 * time, the /p link, the refund rule, the collection statement with R61's
 * processing sentence). Paid -> pending + "received" (the webhook's hook);
 * lapse -> lapsed, which the agent reads as `expired`.
 *
 * - payment unavailable: startDeposit released the hold (lapsed); the diner
 *   gets a fixed text and the step reports the fixed code (R64).
 * - full: the row is declined 'full' as the plain promotion does, and the
 *   caller sends the full reply.
 * - not promotable / cap: nothing changed (replay, another number, cap).
 */
import type { AgentBooking, BookingRequest } from '@/domain/entities/booking-request'
import type { MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import type { MerchantPaymentAccountReader } from '@/domain/ports/booking-deposit'
import type { AgentDepositPromoter } from '@/domain/services/agent-booking-deposit'
import type { RoomCheck } from '@/domain/services/booking-room'
import { hongKongTime } from '@/domain/services/booking-submission'
import { sanitizeTemplateParam } from '@/domain/services/booking-message'
import { buildCollectionStatement, collectionStatementText, termsReplyText } from '@/domain/services/poppy-documents'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import { DEPOSIT_RULE_OFF, type DepositRule } from '@/domain/value-objects/deposit-rule'
import { depositLinkText } from '@/domain/value-objects/deposit-messages'
import { depositTermsText } from '@/domain/value-objects/deposit-terms'
import { MAX_PENDING_PER_PHONE } from '@/domain/entities/booking-request'
import { plannedDeposit, startDeposit, type StartDepositDeps } from '@/application/payments/start-deposit'

export interface AgentCodeDepositDeps {
  accounts: MerchantPaymentAccountReader
  start: StartDepositDeps
  promoter: AgentDepositPromoter
}

export interface CodeStepMessage {
  restaurantId: string
  phone: string
  codes: string[]
  wamid: string
  at: Date
}

export type CodeDepositOutcome =
  | { kind: 'held'; booking: BookingRequest; text: string }
  | { kind: 'payment_unavailable' }
  | { kind: 'full'; declined: AgentBooking }
  | { kind: 'unchanged' }
  /** No deposit applies after all: the caller promotes the row the BOOK-003 way. */
  | { kind: 'not_required' }

/** The rows the rule applies to, and the codes of the others (promoted the BOOK-003 way). */
export async function splitByDeposit(
  deposit: AgentCodeDepositDeps | undefined,
  config: BookingConfig,
  restaurantId: string,
  rows: AgentBooking[]
): Promise<{ plain: string[]; held: AgentBooking[]; account: MerchantPaymentAccount | null }> {
  const rule = config.deposit ?? DEPOSIT_RULE_OFF
  const needs = (r: AgentBooking) => !!deposit && rule.enabled && r.partySize >= rule.fromPartySize
  if (!rows.some(needs)) return { plain: rows.map((r) => r.confirmCode as string), held: [], account: null }
  const account = await (deposit as AgentCodeDepositDeps).accounts.findForRestaurant(restaurantId)
  const held = rows.filter((r) => needs(r) && plannedDeposit(rule, account, r.partySize) !== null)
  return { plain: rows.filter((r) => !held.includes(r)).map((r) => r.confirmCode as string), held, account }
}

/** The WhatsApp text: the link with R61's processing sentence, then BOOK-003's collection statement, then the terms. */
function heldText(input: {
  restaurantName: string
  privacyUrl: string
  booking: BookingRequest
  rule: DepositRule
  started: { amount: { amountMinor: number; currency: string }; expiresAt: string; paymentUrl: string }
}): string {
  const { booking, rule, started } = input
  const name = sanitizeTemplateParam(input.restaurantName)
  const link = depositLinkText({
    restaurantName: name,
    amount: started.amount,
    payBy: hongKongTime(new Date(started.expiresAt)),
    paymentUrl: started.paymentUrl,
    booking: { date: booking.bookingDate, time: booking.bookingTime, partySize: booking.partySize },
    terms: { zh_hk: depositTermsText(rule, started.amount.currency, 'zh_hk'), en: depositTermsText(rule, started.amount.currency, 'en') },
  })
  const statement = collectionStatementText(buildCollectionStatement(input.restaurantName, input.privacyUrl))
  const terms = booking.termsText ? `\n\n${termsReplyText(booking.termsText)}` : ''
  return `${link}\n\n${statement}${terms}`
}

/** One candidate: hold it awaiting its deposit, or say why not. Never throws for a provider failure (R54, R64). */
export async function holdForDeposit(
  deps: { deposit: AgentCodeDepositDeps; privacyUrl: string },
  input: {
    row: AgentBooking
    message: CodeStepMessage
    config: BookingConfig
    account: MerchantPaymentAccount | null
    restaurantName: string
    room: RoomCheck | null
  }
): Promise<CodeDepositOutcome> {
  const { row, message, config } = input
  let declined: AgentBooking | null = null
  const started = await startDeposit(deps.deposit.start, {
    restaurantId: message.restaurantId,
    rule: config.deposit,
    account: input.account,
    partySize: row.partySize,
    holder: 'diner',
    restaurantName: sanitizeTemplateParam(input.restaurantName),
    bookingDate: row.bookingDate,
    bookingTime: row.bookingTime,
    insertBooking: async (hold) => {
      const promoted = await deps.deposit.promoter.promoteToDeposit({
        restaurantId: message.restaurantId,
        phone: message.phone,
        bookingId: row.id,
        codes: message.codes,
        wamid: message.wamid,
        at: message.at,
        maxPending: MAX_PENDING_PER_PHONE,
        room: input.room,
        hold,
      })
      if (promoted.ok) return promoted
      if ('declined' in promoted) declined = promoted.declined
      return { ok: false as const, refusal: promoted.refusal }
    },
  })
  switch (started.kind) {
    case 'started':
      return {
        kind: 'held',
        booking: started.booking,
        text: heldText({ restaurantName: input.restaurantName, privacyUrl: deps.privacyUrl, booking: started.booking, rule: config.deposit, started }),
      }
    case 'payment_unavailable':
      return { kind: 'payment_unavailable' }
    case 'refused':
      return declined ? { kind: 'full', declined } : { kind: 'unchanged' }
    case 'not_required':
      return { kind: 'not_required' }
  }
}
