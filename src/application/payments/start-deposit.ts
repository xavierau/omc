/**
 * BOOK-014 (spec AC-5, AC-9, AC-10, AC-11; threat R53, R54, R61, R62): the
 * ONE entry every booking channel calls when a deposit may apply. The channel
 * supplies its own atomic booking + hold insert (`insertBooking`); this use
 * case owns everything about the money:
 *
 * 1. the amount, from the stored rule and the party size, on the server (R53);
 *    no deposit when the rule is off, the party is below N, or the account
 *    cannot take charges (spec AC-4: the booking is then taken without one);
 * 2. the hold (30 min diner / 24 h staff), the deposit id and the /p token;
 * 3. the insert (booking awaiting_deposit + deposit awaiting, one transaction);
 * 4. the hosted payment session, idempotency key = the deposit id;
 * 5. storing the session. If the provider fails at 4 or the store at 5, the
 *    booking and its hold are released in the same call (R54) and the channel
 *    gets `payment_unavailable`, a fixed code (R64).
 */
import type { BookingRequest } from '@/domain/entities/booking-request'
import { holdMsFor, type BookingDeposit, type DepositHolder, type NewDepositHold } from '@/domain/entities/booking-deposit'
import { isChargeable, type MerchantPaymentAccount } from '@/domain/entities/merchant-payment-account'
import type { BookingDepositStore, PaymentLog } from '@/domain/ports/booking-deposit'
import { PaymentGatewayError, type PaymentGatewayPort, type PaymentGatewayRegistry } from '@/domain/ports/payment-gateway'
import { depositFor, type DepositRule } from '@/domain/value-objects/deposit-rule'
import type { Money } from '@/domain/value-objects/money'
import { paymentLinkPath } from '@/domain/services/payment-link-token'

export interface StartDepositDeps {
  registry: PaymentGatewayRegistry
  deposits: Pick<BookingDepositStore, 'attachSession' | 'abandon'>
  /** The public app URL (no trailing slash); the /p link and return URLs are built on it, server side (R62). */
  appBaseUrl: string
  newId: () => string
  mintToken: () => { token: string; hash: string }
  now: () => Date
  log: PaymentLog
}

export type DepositInsertResult<R> = { ok: true; booking: BookingRequest; deposit: BookingDeposit } | { ok: false; refusal: R }

export interface StartDepositInput<R> {
  restaurantId: string
  rule: DepositRule
  account: MerchantPaymentAccount | null
  partySize: number
  holder: DepositHolder
  /** For the hosted page's one line: "Deposit · <restaurant> · <date> <time> · <party> guests" (R61, no PII). */
  restaurantName: string
  bookingDate: string
  bookingTime: string
  /** The channel's atomic booking + deposit insert (seat check, caps). */
  insertBooking: (hold: NewDepositHold) => Promise<DepositInsertResult<R>>
  /** Where the provider sends the diner back; defaults to the /p link with ?return=success|cancel. */
  returnUrls?: (paymentUrl: string) => { successUrl: string; cancelUrl: string }
}

export type StartDepositResult<R> =
  /** No deposit applies: the channel books the usual way. */
  | { kind: 'not_required' }
  /** The channel's insert refused (full, stopped, cap): nothing was written. */
  | { kind: 'refused'; refusal: R }
  /** R54 / R64: no booking remains; the diner is told payment is unavailable. */
  | { kind: 'payment_unavailable' }
  | { kind: 'started'; booking: BookingRequest; deposit: BookingDeposit; paymentUrl: string; amount: Money; expiresAt: string }

/** What a channel shows before asking (terms, agent text): the amount, or null when none applies. */
export function plannedDeposit(rule: DepositRule, account: MerchantPaymentAccount | null, partySize: number): Money | null {
  if (!isChargeable(account)) return null
  return depositFor(rule, partySize, account.currency)
}

export function depositDescription(input: { restaurantName: string; bookingDate: string; bookingTime: string; partySize: number }): string {
  const name = input.restaurantName.replace(/\s+/g, ' ').trim().slice(0, 80)
  return `Deposit · ${name} · ${input.bookingDate} ${input.bookingTime} · ${input.partySize} guests`
}

function baseUrl(raw: string): string | null {
  const base = raw.trim().replace(/\/+$/, '')
  return /^https?:\/\/[^\s/]+/.test(base) ? base : null
}

export async function startDeposit<R>(deps: StartDepositDeps, input: StartDepositInput<R>): Promise<StartDepositResult<R>> {
  const { account } = input
  if (!isChargeable(account)) return { kind: 'not_required' }
  const amount = depositFor(input.rule, input.partySize, account.currency)
  if (!amount) return { kind: 'not_required' }

  // Before anything is written: no gateway or no public URL means no payment can succeed (AC-4, R54).
  const base = baseUrl(deps.appBaseUrl)
  let gateway: PaymentGatewayPort
  try {
    gateway = deps.registry.get(account.providerCode)
  } catch (err) {
    deps.log('error', 'deposit.gateway_unavailable', { restaurantId: input.restaurantId, provider: account.providerCode, error: (err as Error).name })
    return { kind: 'payment_unavailable' }
  }
  if (!base) {
    deps.log('error', 'deposit.app_url_missing', { restaurantId: input.restaurantId })
    return { kind: 'payment_unavailable' }
  }

  const now = deps.now()
  const link = deps.mintToken()
  const hold: NewDepositHold = {
    id: deps.newId(),
    providerCode: account.providerCode,
    accountId: account.id,
    providerAccountId: account.providerAccountId,
    amount,
    holdExpiresAt: new Date(now.getTime() + holdMsFor(input.holder)).toISOString(),
    linkTokenHash: link.hash,
  }

  const inserted = await input.insertBooking(hold)
  if (!inserted.ok) return { kind: 'refused', refusal: inserted.refusal }
  const { booking, deposit } = inserted

  const paymentUrl = `${base}${paymentLinkPath(link.token)}`
  const urls = input.returnUrls?.(paymentUrl) ?? { successUrl: `${paymentUrl}?return=success`, cancelUrl: `${paymentUrl}?return=cancel` }

  let session: { sessionRef: string; url: string } | null = null
  try {
    session = await gateway.createHostedPayment({
      accountRef: account.providerAccountId,
      amount,
      description: depositDescription({ ...input, partySize: input.partySize }),
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
      expiresAt: new Date(hold.holdExpiresAt),
      idempotencyKey: deposit.id,
      metadata: { deposit_id: deposit.id, booking_id: booking.id },
    })
    const attached = await deps.deposits.attachSession(deposit.id, session)
    if (!attached) throw new Error('session not attached')
    return { kind: 'started', booking, deposit: attached, paymentUrl, amount, expiresAt: hold.holdExpiresAt }
  } catch (err) {
    deps.log('error', 'deposit.start_failed', {
      depositId: deposit.id,
      stage: session ? 'attach' : 'create_session',
      code: err instanceof PaymentGatewayError ? err.code : 'internal',
      error: (err as Error).message,
    })
    await releaseHold(deps, gateway, deposit.id, account.providerAccountId, session)
    return { kind: 'payment_unavailable' }
  }
}

/** R54: lapse the booking + hold now; close a session that was made but not stored. Best effort, logged. */
async function releaseHold(
  deps: StartDepositDeps,
  gateway: PaymentGatewayPort,
  depositId: string,
  accountRef: string,
  session: { sessionRef: string } | null
): Promise<void> {
  try {
    await deps.deposits.abandon(depositId)
  } catch (err) {
    // The hold still lapses at hold_expires_at through the expiry step.
    deps.log('error', 'deposit.abandon_failed', { depositId, error: (err as Error).message })
  }
  if (!session) return
  try {
    await gateway.expireHostedPayment({ accountRef, sessionRef: session.sessionRef })
  } catch (err) {
    deps.log('warn', 'deposit.expire_after_failure_failed', { depositId, error: (err as Error).message })
  }
}
