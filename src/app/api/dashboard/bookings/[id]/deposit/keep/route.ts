/**
 * BOOK-014 W4 (spec AC-13; R56, R58, R60): Keep a paid deposit of a cancelled
 * or no-show booking; terminal, the staff user and time recorded. 200
 * {deposit}; 404 foreign or unknown id; 409 {status} when already refunded,
 * kept or not keepable.
 */
import { keepDeposit } from '@/application/payments/deposit-decisions'
import { depositDecisionDeps } from '@/application/payments/payment-deps'
import { handleDepositMove } from '../../../deposit-response'

export function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleDepositMove(
    params,
    (ctx, bookingId) => keepDeposit(depositDecisionDeps(), { restaurantId: ctx.restaurantId, bookingId, actorUserId: ctx.userId }),
    'keep deposit'
  )
}
