/**
 * BOOK-003 (R31, R32, R44): a diner's WhatsApp text that may carry an agent
 * booking's confirm code.
 *
 * Only code-shaped tokens trigger a lookup. Promotion is one conditional
 * UPDATE bound to the SENDER's phone (from the signed webhook), the code,
 * status unverified and an unexpired window, so a code sent from another
 * number, an expired code and a replayed webhook change nothing. Only a row
 * that changed gets the "received" message and the collection statement.
 * `handled: false` means "not ours": the caller runs today's routing
 * unchanged, and nothing about why is revealed to the sender.
 */
import { extractConfirmCodeCandidates } from '@/domain/services/booking-confirm-code'
import { buildCollectionStatement, collectionStatementText } from '@/domain/services/poppy-documents'
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { AgentBookingStore, BookingMessageSender, BookingSettingsReader } from '@/domain/ports/booking'

export interface VerifyAgentBookingDeps {
  store: Pick<AgentBookingStore, 'promote'>
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  sender: BookingMessageSender
  /** Free text inside the window the diner's own message just opened; never throws. */
  sendText(restaurantId: string, phone: string, text: string): Promise<void>
  privacyUrl: string
  now(): Date
}

export interface InboundCodeMessage {
  restaurantId: string
  phone: string
  text: string
  wamid: string
}

async function acknowledge(deps: VerifyAgentBookingDeps, booking: BookingRequest): Promise<void> {
  const restaurantName = (await deps.settings.getRestaurant(booking.restaurantId))?.name ?? ''
  await deps.sender.send({
    restaurantId: booking.restaurantId, phone: booking.phone, memberId: booking.memberId, kind: 'received',
    details: { restaurantName, name: booking.name, date: booking.bookingDate, time: booking.bookingTime, partySize: booking.partySize },
  })
  await deps.sendText(booking.restaurantId, booking.phone, collectionStatementText(buildCollectionStatement(restaurantName, deps.privacyUrl)))
}

export async function verifyAgentBooking(deps: VerifyAgentBookingDeps, message: InboundCodeMessage): Promise<{ handled: boolean }> {
  const codes = extractConfirmCodeCandidates(message.text)
  if (codes.length === 0) return { handled: false }
  const promoted = await deps.store.promote({
    restaurantId: message.restaurantId, phone: message.phone, codes, wamid: message.wamid, at: deps.now(),
  })
  for (const booking of promoted) await acknowledge(deps, booking)
  return { handled: promoted.length > 0 }
}
