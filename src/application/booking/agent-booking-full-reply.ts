/**
 * BOOK-010 (spec AC-6): a personal agent's booking whose slot filled before
 * the diner sent the WhatsApp code. The code step (promote with room) has
 * already made it `declined` with reason 'full', so staff never see it as a
 * request; here the diner is told, free-form inside the 24 h window their
 * message just opened, with up to 3 times that fit and their booking link.
 * Best effort: a failure is logged by error name and never undoes the decline.
 */
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { BookingRoomReader } from '@/domain/ports/booking'
import { fullReplyText } from '@/domain/services/booking-full-reply'
import { roomCheckFor, roomApplies, type RoomCheck } from '@/domain/services/booking-room'
import { hongKongTime, hongKongToday } from '@/domain/services/booking-submission'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import { fittingSuggestions } from './booking-room-check'

export interface AgentBookingRoomDeps {
  reader: BookingRoomReader
  /** The diner's booking page link (a chat token link), null when none can be made. */
  bookingLink(restaurantId: string, phone: string, config: BookingConfig): Promise<string | null>
}

/** The promote argument: each candidate's room check, when room rules apply. */
export function promoteRoom(room: AgentBookingRoomDeps | undefined, config: BookingConfig) {
  const hours = config.bookingHours
  if (!room || !roomApplies(hours)) return {}
  return { room: (slot: { date: string; time: string }): RoomCheck => roomCheckFor(hours, slot.date, slot.time) }
}

export async function tellFull(
  deps: { room?: AgentBookingRoomDeps; sendText(restaurantId: string, phone: string, text: string): Promise<void>; now(): Date },
  booking: BookingRequest,
  config: BookingConfig
): Promise<void> {
  const hours = config.bookingHours
  if (!deps.room || !roomApplies(hours)) return
  try {
    const now = deps.now()
    const ctx = { restaurantId: booking.restaurantId, hours, clock: { today: hongKongToday(now), nowTime: hongKongTime(now) } }
    const req = { date: booking.bookingDate, time: booking.bookingTime, partySize: booking.partySize }
    const [suggestions, link] = await Promise.all([
      fittingSuggestions(deps.room.reader, ctx, req),
      deps.room.bookingLink(booking.restaurantId, booking.phone, config),
    ])
    await deps.sendText(booking.restaurantId, booking.phone, fullReplyText({ ...req, suggestions, link }))
  } catch (err) {
    console.error('[AgentBooking] full reply failed:', { error: (err as Error).name, bookingId: booking.id })
  }
}
