/**
 * BOOK-014 W6-fix F2 (threat R56, R57): a late-payment refund (the diner paid
 * after the hold lapsed) that ends refund_failed is invisible to staff (the
 * booking lapsed), so the stalled-refund sweep retries it as a NEW attempt
 * (new idempotency key refund:<id>:<attempt>), with backoff measured from when
 * the current attempt was claimed, by the database clock:
 *
 *   attempt 1 failed -> retry after 15 min; 2 -> 1 h; 3 -> 4 h; 4 -> 16 h.
 *
 * At most LATE_REFUND_MAX_ATTEMPTS attempts in all (about 21 hours from the
 * first). When the last one fails the deposit stays refund_failed and one
 * error line names it (deposit.late_refund_gave_up) for a human to act on.
 * Staff-path refund_failed (declined / staff) is untouched: staff press Retry.
 */
import type { BookingDeposit } from '@/domain/entities/booking-deposit'
import type { PaymentLog } from '@/domain/ports/booking-deposit'

export const LATE_REFUND_MAX_ATTEMPTS = 5
export const LATE_REFUND_BACKOFF_BASE_MS = 15 * 60_000
export const LATE_REFUND_BACKOFF_FACTOR = 4

/** Logs once, at error level, the late-payment refund that failed its last allowed attempt. */
export function noteLateRefundFailure(log: PaymentLog, deposit: BookingDeposit): void {
  if (deposit.status !== 'refund_failed' || deposit.refundReason !== 'late_payment') return
  if (deposit.refundAttempts < LATE_REFUND_MAX_ATTEMPTS) return
  log('error', 'deposit.late_refund_gave_up', { depositId: deposit.id, attempts: deposit.refundAttempts })
}
