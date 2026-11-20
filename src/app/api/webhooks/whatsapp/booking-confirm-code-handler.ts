/**
 * BOOK-003 (R31, R32): the agent booking confirm-code check, run first for
 * inbound text. True only when the text promoted a booking (the diner got the
 * "received" reply and the collection statement); false for anything else,
 * so the caller runs today's routing unchanged. A failure here is logged and
 * falls through: it must never cost the diner today's reply.
 */
import { verifyAgentBooking } from '@/application/booking/verify-agent-booking'
import { verifyAgentBookingDeps } from '@/application/booking/booking-deps'
import { extractConfirmCodeCandidates } from '@/domain/services/booking-confirm-code'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void

export async function maybeHandleBookingConfirmCode(
  message: KapsoMessage,
  restaurantId: string,
  phone: string,
  log: LogFn
): Promise<boolean> {
  if (message.type !== 'text' || !message.text) return false
  // Cheap pre-check: no code-shaped token, no deps and no query.
  if (extractConfirmCodeCandidates(message.text).length === 0) return false
  try {
    const { handled } = await verifyAgentBooking(verifyAgentBookingDeps(), {
      restaurantId,
      phone,
      text: message.text,
      wamid: message.messageId,
    })
    if (handled) log('info', 'handler.agent_booking_verified', { messageId: message.messageId })
    return handled
  } catch (err) {
    log('warn', 'handler.agent_booking_check_failed', { error: (err as Error).name })
    return false
  }
}
