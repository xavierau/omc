/**
 * BOOK-014 W4 (spec AC-12, AC-13; R56, R58, R60): Refund a paid deposit of a
 * cancelled, no-show (or declined) booking in full, or Retry a refund the
 * provider refused (refund_failed: a new attempt, a new idempotency key).
 * The staff user is recorded on the deposit and its event. 200 {deposit};
 * 404 foreign or unknown id; 409 {status} when the deposit cannot move.
 */
import { refundDeposit, retryDepositRefund } from '@/application/payments/deposit-decisions'
import { depositDecisionDeps } from '@/application/payments/payment-deps'
import { handleDepositMove } from '../../../deposit-response'

export function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleDepositMove(
    params,
    async (ctx, bookingId) => {
      const deps = depositDecisionDeps()
      const input = { restaurantId: ctx.restaurantId, bookingId, actorUserId: ctx.userId }
      const current = await deps.deposits.findByBookingForRestaurant(ctx.restaurantId, bookingId)
      if (current?.status === 'refund_failed') return retryDepositRefund(deps, input)
      return refundDeposit(deps, { ...input, reason: 'staff' })
    },
    'refund deposit'
  )
}
