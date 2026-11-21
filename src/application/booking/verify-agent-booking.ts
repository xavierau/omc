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
 * Once a row is promoted the text was ours (review G3): a failed
 * acknowledgement is logged by error name and never sends the diner to the
 * fallback menu or skips the other promoted rows.
 * BOOK-008 (R1): a promoted booking links to an EXISTING member of the same
 * restaurant with the booking phone (never before: the phone is unproven
 * while unverified). Best effort: a failed link is logged by error name and
 * staff can link by hand; no member is ever created.
 * BOOK-009 W4 (spec AC-13): when terms are set, the same free-form text also
 * carries the terms: the exact text stored on the booking, else the
 * restaurant's current terms. No new Meta template (inside the 24 h window).
 * BOOK-010 (spec AC-6): promotion also checks room under the date lock; a
 * booking whose slot filled comes back declined 'full' and the diner gets
 * the full reply instead (agent-booking-full-reply.ts).
 */
import { extractConfirmCodeCandidates } from '@/domain/services/booking-confirm-code'
import { buildCollectionStatement, collectionStatementText, termsReplyText } from '@/domain/services/poppy-documents'
import { termsSnapshot } from '@/domain/value-objects/booking-hours'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import { MAX_PENDING_PER_PHONE, type BookingRequest } from '@/domain/entities/booking-request'
import type { AgentBookingStore, BookingMemberLookup, BookingMessageSender, BookingSettingsReader } from '@/domain/ports/booking'
import { promoteRoom, tellFull, type AgentBookingRoomDeps } from './agent-booking-full-reply'

export interface VerifyAgentBookingDeps {
  store: Pick<AgentBookingStore, 'promote' | 'linkMember'>
  members: BookingMemberLookup
  settings: Pick<BookingSettingsReader, 'getConfig' | 'getRestaurant'>
  sender: BookingMessageSender
  /** Free text inside the window the diner's own message just opened; never throws. */
  sendText(restaurantId: string, phone: string, text: string): Promise<void>
  privacyUrl: string
  now(): Date
  /** BOOK-010: room check at promotion and the full reply; absent = BOOK-009 promotion. */
  room?: AgentBookingRoomDeps
}

export interface InboundCodeMessage {
  restaurantId: string
  phone: string
  text: string
  wamid: string
}

/** The collection statement, then (BOOK-009 AC-13) the terms the diner accepted. */
function confirmedText(statement: string, booking: BookingRequest, config: BookingConfig): string {
  const terms = booking.termsText ?? termsSnapshot(config.bookingHours)
  return terms ? `${statement}\n\n${termsReplyText(terms)}` : statement
}

async function acknowledge(deps: VerifyAgentBookingDeps, booking: BookingRequest, config: BookingConfig): Promise<void> {
  const restaurantName = (await deps.settings.getRestaurant(booking.restaurantId))?.name ?? ''
  await deps.sender.send({
    restaurantId: booking.restaurantId, phone: booking.phone, memberId: booking.memberId, kind: 'received',
    details: { restaurantName, name: booking.name, date: booking.bookingDate, time: booking.bookingTime, partySize: booking.partySize },
  })
  const statement = collectionStatementText(buildCollectionStatement(restaurantName, deps.privacyUrl))
  await deps.sendText(booking.restaurantId, booking.phone, confirmedText(statement, booking, config))
}

/** R1: only now, after promotion, does the booking phone count as the diner's. */
async function linkExistingMember(deps: VerifyAgentBookingDeps, booking: BookingRequest): Promise<BookingRequest> {
  if (booking.memberId) return booking
  try {
    const memberId = await deps.members.findMemberId(booking.restaurantId, booking.phone)
    if (memberId && (await deps.store.linkMember(booking.id, booking.restaurantId, memberId))) return { ...booking, memberId }
  } catch (err) {
    console.warn('[AgentBooking] member link failed:', { error: (err as Error).name, bookingId: booking.id })
  }
  return booking
}

export async function verifyAgentBooking(deps: VerifyAgentBookingDeps, message: InboundCodeMessage): Promise<{ handled: boolean }> {
  const codes = extractConfirmCodeCandidates(message.text)
  if (codes.length === 0) return { handled: false }
  const config = await deps.settings.getConfig(message.restaurantId)
  if (!config.agentBooking.enabled || config.mode !== 'simple') return { handled: false }
  const promoted = await deps.store.promote({
    restaurantId: message.restaurantId, phone: message.phone, codes, wamid: message.wamid, at: deps.now(),
    maxPending: MAX_PENDING_PER_PHONE, ...promoteRoom(deps.room, config),
  })
  for (const row of promoted) {
    if (row.status === 'declined') {
      await tellFull(deps, row, config)
      continue
    }
    const booking = await linkExistingMember(deps, row)
    try {
      await acknowledge(deps, booking, config)
    } catch (err) {
      console.error('[AgentBooking] acknowledge failed:', { error: (err as Error).name, bookingId: booking.id })
    }
  }
  return { handled: promoted.length > 0 }
}
