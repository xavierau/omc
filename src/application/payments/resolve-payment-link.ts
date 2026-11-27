/**
 * BOOK-014 (threat R62): what GET /p/<token> does. The token is looked up by
 * its hash only. An open hold redirects (303) to the stored hosted-payment
 * URL, and only when that URL is https on a host the deposit's provider
 * allows; everything else is a neutral page that shows no booking details.
 *
 * `returned` is the provider sending the diner back (?return=success|cancel,
 * our own URLs): after success the webhook may not have landed yet, so the
 * page says the payment is being confirmed instead of redirecting again.
 */
import type { BookingDepositStore, PaymentLog } from '@/domain/ports/booking-deposit'
import type { PaymentGatewayRegistry } from '@/domain/ports/payment-gateway'
import { hashPaymentLinkToken, isPaymentLinkTokenShape } from '@/domain/services/payment-link-token'

export interface ResolvePaymentLinkDeps {
  deposits: Pick<BookingDepositStore, 'findByLinkTokenHash'>
  registry: PaymentGatewayRegistry
  now: () => Date
  log: PaymentLog
}

export type PaymentLinkState =
  | { kind: 'redirect'; url: string }
  | { kind: 'not_found' }
  | { kind: 'lapsed' }
  | { kind: 'paid' }
  | { kind: 'processing' }
  /** Back from the hosted page without paying, hold still open: "you have until HH:MM" + Pay now. */
  | { kind: 'unfinished'; holdExpiresAt: string }
  | { kind: 'unavailable' }

export function isAllowedRedirect(url: string, hosts: readonly string[]): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && hosts.includes(parsed.hostname)
  } catch {
    return false
  }
}

export async function resolvePaymentLink(
  deps: ResolvePaymentLinkDeps,
  input: { token: string; returned: 'success' | 'cancel' | null }
): Promise<PaymentLinkState> {
  if (!isPaymentLinkTokenShape(input.token)) return { kind: 'not_found' }
  const deposit = await deps.deposits.findByLinkTokenHash(hashPaymentLinkToken(input.token))
  if (!deposit) return { kind: 'not_found' }

  if (deposit.status === 'lapsed' || (deposit.status !== 'awaiting' && deposit.refundReason === 'late_payment')) return { kind: 'lapsed' }
  if (deposit.status !== 'awaiting') return { kind: 'paid' }
  if (Date.parse(deposit.holdExpiresAt) <= deps.now().getTime()) return { kind: 'lapsed' }
  if (input.returned === 'success') return { kind: 'processing' }
  if (input.returned === 'cancel') return { kind: 'unfinished', holdExpiresAt: deposit.holdExpiresAt }

  let hosts: readonly string[] = []
  try {
    hosts = deps.registry.get(deposit.providerCode).allowedRedirectHosts
  } catch (err) {
    deps.log('error', 'payment_link.gateway_unavailable', { depositId: deposit.id, error: (err as Error).name })
    return { kind: 'unavailable' }
  }
  if (!deposit.sessionUrl || !isAllowedRedirect(deposit.sessionUrl, hosts)) {
    deps.log('warn', 'payment.security_mismatch', { reason: 'redirect_host', depositId: deposit.id })
    return { kind: 'unavailable' }
  }
  return { kind: 'redirect', url: deposit.sessionUrl }
}
