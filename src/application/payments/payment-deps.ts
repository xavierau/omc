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
import { releaseIdempotencyKey, tryMarkProcessed } from '@/infrastructure/supabase/idempotency'
import { appBaseUrl } from '@/infrastructure/config/app-url'
import { mintPaymentLinkToken } from '@/domain/services/payment-link-token'
import type { PaymentProviderCode } from '@/domain/ports/payment-gateway'
import type { WebhookClaimStore } from '@/domain/ports/booking-deposit'
import type { StartDepositDeps } from './start-deposit'
import type { ProcessPaymentWebhookDeps } from './process-payment-webhook'
import type { DepositPaid } from './handle-payment-event'
import type { ExpireDepositsDeps } from './expire-deposits'
import type { RedriveRefundsDeps } from './redrive-stalled-refunds'
import type { DepositDecisionDeps } from './deposit-decisions'
import type { ResolvePaymentLinkDeps } from './resolve-payment-link'

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
 * The payment webhook of one provider. Throws when the provider is not
 * configured (the route answers 500, R47). `onDepositPaid` is the channel hook
 * (W3/W5 send the "received" message from it); none in W1.
 */
export function paymentWebhookDeps(
  code: PaymentProviderCode,
  onDepositPaid?: (paid: DepositPaid) => Promise<void>
): ProcessPaymentWebhookDeps {
  const registry = productionPaymentRegistry()
  return {
    gateway: registry.get(code),
    claims: webhookClaims,
    deposits: bookingDepositStore,
    registry,
    now,
    log: paymentLog,
    ...(onDepositPaid ? { onDepositPaid } : {}),
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

/** Refund / Retry / Keep (W4 adds the routes). */
export function depositDecisionDeps(): DepositDecisionDeps {
  return { deposits: bookingDepositStore, registry: productionPaymentRegistry(), log: paymentLog, now }
}

/** GET /p/<token>. */
export function paymentLinkDeps(): ResolvePaymentLinkDeps {
  return { deposits: bookingDepositStore, registry: productionPaymentRegistry(), now, log: paymentLog }
}
