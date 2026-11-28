/**
 * BOOK-014 (spec AC-7; threat R55, R57): the expiry step of the 5-minute
 * booking-reminders cron. The database lapses every awaiting hold whose time
 * is up (by its own clock, batched), booking and deposit together, which
 * frees the seats. Then each lapsed hold's hosted session is closed so it can
 * no longer be paid: best effort, and a session that was already completed is
 * left to the payment webhook (a payment that raced the lapse is refunded there).
 * W6a: then `onLapsed` (the AI agent's "hold lapsed" text); its failure is
 * logged and never fails the batch.
 */
import type { BookingDeposit } from '@/domain/entities/booking-deposit'
import type { BookingDepositStore, PaymentLog } from '@/domain/ports/booking-deposit'
import type { PaymentGatewayRegistry } from '@/domain/ports/payment-gateway'

/** Plan budget: 200 lapses in ≤ 10 s; sessions are closed this many at a time. */
export const EXPIRY_BATCH = 200
const EXPIRE_CONCURRENCY = 10

export interface ExpireDepositsDeps {
  deposits: Pick<BookingDepositStore, 'lapseExpired'>
  registry: PaymentGatewayRegistry
  log: PaymentLog
  /** W6a: told the deposits this run lapsed (each once); absent = nothing sent. */
  onLapsed?: (lapsed: BookingDeposit[]) => Promise<void>
}

export interface ExpireDepositsResult {
  depositsLapsed: number
  sessionsClosed: number
}

async function closeSession(deps: ExpireDepositsDeps, deposit: BookingDeposit): Promise<boolean> {
  if (!deposit.providerSessionId) return false
  try {
    const { expired } = await deps.registry.get(deposit.providerCode).expireHostedPayment({
      accountRef: deposit.providerAccountId,
      sessionRef: deposit.providerSessionId,
    })
    return expired
  } catch (err) {
    deps.log('warn', 'deposit.session_close_failed', { depositId: deposit.id, error: (err as Error).message })
    return false
  }
}

export async function expireDeposits(deps: ExpireDepositsDeps): Promise<ExpireDepositsResult> {
  const lapsed = await deps.deposits.lapseExpired(EXPIRY_BATCH)
  let sessionsClosed = 0
  for (let i = 0; i < lapsed.length; i += EXPIRE_CONCURRENCY) {
    const closed = await Promise.all(lapsed.slice(i, i + EXPIRE_CONCURRENCY).map((d) => closeSession(deps, d)))
    sessionsClosed += closed.filter(Boolean).length
  }
  if (lapsed.length > 0) deps.log('info', 'deposit.lapsed', { count: lapsed.length, sessionsClosed })
  if (lapsed.length > 0 && deps.onLapsed) {
    await deps.onLapsed(lapsed).catch((err: Error) => deps.log('warn', 'deposit.lapse_hook_failed', { count: lapsed.length, error: err.name }))
  }
  return { depositsLapsed: lapsed.length, sessionsClosed }
}
