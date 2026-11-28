/**
 * BOOK-014: composition root for the deposit use cases (as booking-deps.ts is
 * for bookings). Routes take their dependencies from here; tests pass fakes
 * and the test adapter instead. The registry decides the provider per
 * deposit / account (spec AC-15); no Stripe import here (R51).
 */
import { randomUUID } from 'node:crypto'
import { productionPaymentRegistry } from '@/infrastructure/payments/registry'
import { paymentLog } from '@/infrastructure/payments/payment-logger'
import { bookingDepositStore, depositBookingWriter } from '@/infrastructure/supabase/repositories/booking-deposit-repository'
import { merchantPaymentAccountReader } from '@/infrastructure/supabase/repositories/merchant-payment-account-repository'
import { merchantPaymentAccountStore } from '@/infrastructure/supabase/repositories/merchant-payment-account-store'
import { releaseIdempotencyKey, tryMarkProcessed } from '@/infrastructure/supabase/idempotency'
import { appBaseUrl } from '@/infrastructure/config/app-url'
import { findStaffBooking } from '@/infrastructure/supabase/repositories/staff-booking-repository'
import { bookingSettingsReader } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { bookingTokenStore } from '@/infrastructure/supabase/repositories/booking-token-repository'
import { paymentLinkDetailsReader } from '@/infrastructure/supabase/repositories/payment-link-details-repository'
import { mintPaymentLinkToken } from '@/domain/services/payment-link-token'
import type { PaymentProviderCode } from '@/domain/ports/payment-gateway'
import type { WebhookClaimStore } from '@/domain/ports/booking-deposit'
import type { StartDepositDeps } from './start-deposit'
import type { ProcessPaymentWebhookDeps } from './process-payment-webhook'
import type { DepositPaid } from './handle-payment-event'
import type { ExpireDepositsDeps } from './expire-deposits'
import type { RedriveRefundsDeps } from './redrive-stalled-refunds'
import type { DepositDecisionDeps, StaffDepositLinkDeps } from './deposit-decisions'
import type { ResolvePaymentLinkDeps } from './resolve-payment-link'
import type { PaymentAccountDeps } from './payment-account'
import type { BookingPageDepositDeps } from './booking-page-deposit'
import { recordDecisionMessage } from '@/infrastructure/supabase/repositories/booking-request-repository'
import { depositPaidHook } from './deposit-paid-hook'

const now = () => new Date()

const webhookClaims: WebhookClaimStore = {
  claim: (key) => tryMarkProcessed(key, (level, event, data) => paymentLog(level === 'critical' ? 'error' : level, event, data as Record<string, unknown>)),
  release: releaseIdempotencyKey,
}

/** For the channels (W3 /b, W5 agents): the account and the atomic booking + deposit writer. */
export const depositChannelPorts = { accounts: merchantPaymentAccountReader, writer: depositBookingWriter }

export function startDepositDeps(): StartDepositDeps {
  return {
    registry: productionPaymentRegistry(),
    deposits: bookingDepositStore,
    appBaseUrl: appBaseUrl(),
    newId: randomUUID,
    mintToken: mintPaymentLinkToken,
    now,
    log: paymentLog,
  }
}

/**
 * The paid-event hook of every booking source (W6a, W5 merge note D1): the
 * booking page's (chat, campaign: "received", W3), the agents' (AI agent and
 * personal agents: "received", W5) and staff's ("confirmed", W5). Each source
 * gets exactly one diner message. booking-deps imports this module, so its
 * sender is loaded at call time.
 */
async function depositPaid(paid: DepositPaid): Promise<void> {
  const { bookingMessageSender } = await import('@/application/booking/booking-deps')
  await depositPaidHook({ settings: bookingSettingsReader, sender: bookingMessageSender(), recordMessage: recordDecisionMessage })(paid)
}

/**
 * The payment webhook of one provider. Throws when the provider is not
 * configured (the route answers 500, R47). `onDepositPaid` is the channel hook;
 * the default sends each booking source's message (depositPaidHook).
 */
export function paymentWebhookDeps(
  code: PaymentProviderCode,
  onDepositPaid: (paid: DepositPaid) => Promise<void> = depositPaid
): ProcessPaymentWebhookDeps {
  const registry = productionPaymentRegistry()
  return {
    gateway: registry.get(code),
    claims: webhookClaims,
    deposits: bookingDepositStore,
    registry,
    accounts: merchantPaymentAccountStore,
    now,
    log: paymentLog,
    onDepositPaid,
  }
}

/** The expiry step of /api/cron/booking-reminders. */
export function expireDepositsDeps(): ExpireDepositsDeps {
  return { deposits: bookingDepositStore, registry: productionPaymentRegistry(), log: paymentLog }
}

/** The stalled-refund step of /api/cron/booking-reminders (review finding 1b). */
export function redriveRefundsDeps(): RedriveRefundsDeps {
  return { deposits: bookingDepositStore, registry: productionPaymentRegistry(), log: paymentLog }
}

/** Refund / Retry / Keep (W4's /deposit routes and the decline refund). */
export function depositDecisionDeps(): DepositDecisionDeps {
  return { deposits: bookingDepositStore, registry: productionPaymentRegistry(), log: paymentLog, now }
}

/** W4: Copy link on a staff booking awaiting its deposit. */
export function staffDepositLinkDeps(): StaffDepositLinkDeps {
  return { deposits: bookingDepositStore, registry: productionPaymentRegistry(), findBooking: findStaffBooking }
}

/** GET /p/<token>; W3: with the booking slot and restaurant name on the live-link pages. */
export function paymentLinkDeps(): ResolvePaymentLinkDeps {
  return {
    deposits: bookingDepositStore,
    registry: productionPaymentRegistry(),
    now,
    log: paymentLog,
    details: paymentLinkDetailsReader,
    restaurants: bookingSettingsReader,
  }
}

/** W3: the deposit line on the /b page. */
export function bookingPageDepositDeps(): BookingPageDepositDeps {
  return { tokens: bookingTokenStore, settings: bookingSettingsReader, accounts: merchantPaymentAccountReader, now }
}

/** W2: Settings → Booking → Payments (connect, status). New accounts open with Stripe. */
export function paymentAccountDeps(): PaymentAccountDeps {
  return {
    registry: productionPaymentRegistry(),
    accounts: merchantPaymentAccountStore,
    onboardingProvider: 'stripe',
    appBaseUrl: appBaseUrl(),
    now,
    log: paymentLog,
  }
}
