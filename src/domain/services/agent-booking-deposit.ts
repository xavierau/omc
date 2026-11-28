/**
 * BOOK-014 W5 (spec AC-10; threat R55, R59, R62): a personal agent's booking
 * whose diner sent the confirm code, when the restaurant asks a deposit.
 *
 * - `AgentDepositPromoter`: the code step's write for ONE candidate. Instead
 *   of unverified -> pending it moves the row unverified -> awaiting_deposit
 *   and inserts its deposit (status awaiting) in the same transaction, under
 *   the same per-phone lock and cap as the promotion, and the same date lock
 *   and seat check when room rules apply (promote_agent_booking_to_deposit,
 *   migration 097). A slot that filled comes back declined 'full', as the
 *   plain promotion does.
 * - `agentDepositView`: what GET /bookings/{id} adds while the booking waits
 *   for its deposit: the amount and when the hold ends, and the stored hosted
 *   payment URL only when its host is the provider's (R62). The /p token is
 *   stored hashed, so it cannot be shown again.
 */
import type { BookingDeposit, NewDepositHold } from '@/domain/entities/booking-deposit'
import type { AgentBooking, BookingRequest } from '@/domain/entities/booking-request'
import type { RoomCheck, RoomRefusal } from '@/domain/services/booking-room'
import { minorUnitDigits, type Money } from '@/domain/value-objects/money'

export interface PromoteToDepositArgs {
  restaurantId: string
  /** The webhook sender, E.164 (signed webhook). */
  phone: string
  bookingId: string
  /** The codes the diner's message carried; the row must still hold one of them. */
  codes: string[]
  wamid: string
  at: Date
  maxPending: number
  /** BOOK-010: the candidate's room check when room rules apply; null = none. */
  room: RoomCheck | null
  hold: NewDepositHold
}

export type PromoteToDepositResult =
  | { ok: true; booking: BookingRequest; deposit: BookingDeposit }
  /** No longer promotable (replay, expired, another number), or the phone is at its cap: nothing changed. */
  | { ok: false; refusal: { kind: 'not_promotable' } | { kind: 'pending_cap' } }
  /** The slot filled: the row is now declined 'full' (as promote_agent_booking_with_room). */
  | { ok: false; refusal: RoomRefusal; declined: AgentBooking }

export interface AgentDepositPromoter {
  promoteToDeposit(args: PromoteToDepositArgs): Promise<PromoteToDepositResult>
}

/** The amount as a decimal string in major units ("400", "12.50"), never a float. */
export function majorUnits(m: Money): string {
  const digits = minorUnitDigits(m.currency)
  if (digits === 0) return String(m.amountMinor)
  const whole = Math.floor(m.amountMinor / 10 ** digits)
  const fraction = m.amountMinor % 10 ** digits
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(digits, '0')}`
}

export interface AgentDepositView {
  payment_url?: string
  deposit: { amount: string; currency: string; expires_at: string }
}

/** Only an awaiting deposit is shown; `allowedUrl` says whether the stored URL may be handed out (R62). */
export function agentDepositView(deposit: BookingDeposit, allowedUrl: (url: string) => boolean): AgentDepositView | null {
  if (deposit.status !== 'awaiting') return null
  const view: AgentDepositView = {
    deposit: { amount: majorUnits(deposit.amount), currency: deposit.amount.currency, expires_at: deposit.holdExpiresAt },
  }
  if (deposit.sessionUrl && allowedUrl(deposit.sessionUrl)) view.payment_url = deposit.sessionUrl
  return view
}
