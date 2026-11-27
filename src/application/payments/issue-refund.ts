/**
 * BOOK-014 (threat R56): the provider refund for a deposit that WON the move
 * to refund_pending. Only the caller holding that row calls this, with the
 * idempotency key refund:<deposit id>:<attempt>, for the full paid amount.
 *
 * succeeded -> refunded; failed or any provider error -> refund_failed (staff
 * see Retry); pending -> stays refund_pending with the refund id stored, and
 * the refund webhook settles it.
 */
import { refundIdempotencyKey, type BookingDeposit } from '@/domain/entities/booking-deposit'
import type { BookingDepositStore, PaymentLog } from '@/domain/ports/booking-deposit'
import { PaymentGatewayError, type PaymentGatewayRegistry } from '@/domain/ports/payment-gateway'

export interface IssueRefundDeps {
  registry: PaymentGatewayRegistry
  deposits: Pick<BookingDepositStore, 'finishRefund' | 'recordRefundRef'>
  log: PaymentLog
}

export async function issueRefund(deps: IssueRefundDeps, deposit: BookingDeposit): Promise<BookingDeposit> {
  const attempt = deposit.refundAttempts
  const fail = async (code: string) => {
    deps.log('warn', 'deposit.refund_failed', { depositId: deposit.id, attempt, code })
    return (
      (await deps.deposits.finishRefund({ depositId: deposit.id, attempt, outcome: 'refund_failed', refundRef: null, actor: 'system' })) ??
      deposit
    )
  }
  if (deposit.status !== 'refund_pending' || !deposit.providerPaymentRef) return fail('not_refundable')

  let result
  try {
    result = await deps.registry.get(deposit.providerCode).refund({
      accountRef: deposit.providerAccountId,
      paymentRef: deposit.providerPaymentRef,
      amount: deposit.amount,
      idempotencyKey: refundIdempotencyKey(deposit.id, attempt),
    })
  } catch (err) {
    deps.log('error', 'deposit.refund_call_failed', {
      depositId: deposit.id,
      attempt,
      code: err instanceof PaymentGatewayError ? err.code : 'internal',
      error: (err as Error).message,
    })
    return fail(err instanceof PaymentGatewayError ? err.code : 'internal')
  }

  if (result.status === 'pending') {
    await deps.deposits.recordRefundRef({ depositId: deposit.id, attempt, refundRef: result.refundRef })
    return { ...deposit, refundRef: result.refundRef }
  }
  const finished = await deps.deposits.finishRefund({
    depositId: deposit.id,
    attempt,
    outcome: result.status === 'succeeded' ? 'refunded' : 'refund_failed',
    refundRef: result.refundRef,
    actor: 'provider',
  })
  return finished ?? deposit
}
