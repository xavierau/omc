/**
 * BOOK-014 W5 (spec AC-9, AC-10, AC-11): the paid-event hook of the agent and
 * staff channels. handlePaymentEvent calls it only on the one transition that
 * moved the booking out of awaiting_deposit, so a replayed or late event
 * sends nothing (W1 CAS + webhook idempotency).
 *
 * - An agent booking (our AI agent or a personal agent) is now pending: the
 *   diner gets BOOK-001's "received" message, which waited for the payment.
 * - A staff booking is now confirmed (staff already accepted it): the diner
 *   gets the same "confirmed" message staff create sends for a confirmed
 *   booking, only with Notify on and a phone, and its outcome is stored as
 *   the row's message status, as staff create does. No staff throttle: this
 *   is the provider's event, not a staff action.
 * The booking page's sources (chat, campaign) are W3's hook. Best effort: a
 * send failure is logged by the caller and never undoes the payment.
 */
import { hasPhone, type DecisionMessageStatus } from '@/domain/entities/booking-request'
import type { BookingMessageSender, BookingSettingsReader } from '@/domain/ports/booking'
import { notifyReceived } from '@/application/booking/submit-booking-request'
import { bookingMessageFor } from '@/application/booking/booking-message-for'
import type { DepositPaid } from './handle-payment-event'

export interface ChannelPaidHookDeps {
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  sender: BookingMessageSender
  /** The row's decision message status (the BOOK-001 "not delivered" badge). */
  recordMessage(id: string, restaurantId: string, status: DecisionMessageStatus): Promise<void>
}

export function agentAndStaffPaidHook(deps: ChannelPaidHookDeps): (paid: DepositPaid) => Promise<void> {
  return async ({ booking }) => {
    if (booking.source === 'agent' && booking.status === 'pending') {
      await notifyReceived(deps, booking)
      return
    }
    if (booking.source !== 'staff' || booking.status !== 'confirmed') return
    // BOOK-013 review R2 / decision 9: Notify off or no phone means no diner message.
    if (booking.notifyDiner === false || !hasPhone(booking)) return
    const result = await deps.sender.send(await bookingMessageFor(deps, booking, 'confirmed'))
    await deps.recordMessage(booking.id, booking.restaurantId, result.delivered ? 'delivered' : 'not_delivered')
  }
}
