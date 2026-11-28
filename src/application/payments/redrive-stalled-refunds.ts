/**
 * BOOK-014 (review finding 1b; threat R56, R57): the stalled-refund step of
 * the 5-minute booking-reminders cron. A deposit in refund_pending with no
 * refund id for over 10 minutes is a refund that was never issued (the call
 * failed and so did recording it, or the process died between the claim and
 * the call). It is re-driven with the SAME attempt, so the same idempotency
 * key: a refund the provider did make comes back instead of a second one, and
 * one past the key window is answered "already refunded" (finding 1c).
 * A re-drive that fails ends refund_failed (staff see Retry), so a row is
 * swept at most until it gets an answer.
 */
import type { BookingDeposit } from '@/domain/entities/booking-deposit'
import type { BookingDepositStore, PaymentLog } from '@/domain/ports/booking-deposit'
import type { PaymentGatewayRegistry } from '@/domain/ports/payment-gateway'
import { issueRefund } from './issue-refund'

/** Longer than any refund call (10 s timeout, one retry), so a call in flight is never doubled. */
export const STALLED_REFUND_AFTER_MS = 10 * 60_000
export const REDRIVE_BATCH = 50
const REDRIVE_CONCURRENCY = 5

export interface RedriveRefundsDeps {
  deposits: Pick<BookingDepositStore, 'listStalledRefunds' | 'finishRefund' | 'recordRefundRef'>
  registry: PaymentGatewayRegistry
  log: PaymentLog
}

export interface RedriveRefundsResult {
  refundsRedriven: number
}

/** One row's failure (e.g. the database write after the call) never stops the batch; the row is swept again next run. */
async function redrive(deps: RedriveRefundsDeps, deposit: BookingDeposit): Promise<void> {
  try {
    const after = await issueRefund(deps, deposit)
    deps.log('info', 'deposit.refund_redriven', { depositId: deposit.id, attempt: deposit.refundAttempts, status: after.status })
  } catch (err) {
    deps.log('error', 'deposit.refund_redrive_failed', { depositId: deposit.id, attempt: deposit.refundAttempts, error: (err as Error).message })
  }
}

export async function redriveStalledRefunds(deps: RedriveRefundsDeps): Promise<RedriveRefundsResult> {
  const stalled = await deps.deposits.listStalledRefunds(REDRIVE_BATCH, STALLED_REFUND_AFTER_MS)
  for (let i = 0; i < stalled.length; i += REDRIVE_CONCURRENCY) {
    await Promise.all(stalled.slice(i, i + REDRIVE_CONCURRENCY).map((d) => redrive(deps, d)))
  }
  return { refundsRedriven: stalled.length }
}
