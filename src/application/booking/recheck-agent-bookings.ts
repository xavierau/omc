/**
 * BOOK-009 F1 (review P2-2): before the confirm-code step promotes anything,
 * each candidate row is re-checked against the booking rules NOW
 * (`recheckAgentBooking`). Only the codes that still pass go on to `promote`.
 *
 * - `rules`: declined with reason 'rules' (no staff action), and the diner is
 *   told the time is no longer available, with alternatives and the link.
 * - `terms`: left unverified (it expires), and the diner is asked to book
 *   again through their agent or the link.
 *
 * Replies are best effort: `sendText` never throws, a failed link is left out.
 */
import { recheckAgentBooking, termsNowRequiredText, timeUnavailableText } from '@/domain/services/agent-booking-recheck'
import type { AgentBooking } from '@/domain/entities/booking-request'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type { AgentBookingStore, BookingRoomReader } from '@/domain/ports/booking'
import { fitsFor, roomApplies, type RoomState, type SlotFits } from '@/domain/services/booking-room'
import { windowEnd } from '@/domain/services/booking-hours'
import { hongKongToday } from '@/domain/services/booking-submission'
import { bookingRulesAt } from './submit-booking-request'

export interface RecheckAgentBookingsDeps {
  store: Pick<AgentBookingStore, 'findPromotable' | 'declineUnverified'>
  /** Free text inside the window the diner's own message just opened; never throws. */
  sendText(restaurantId: string, phone: string, text: string): Promise<void>
  /** The diner's booking-page link (`/b/<token>`), or null; optional so tests can leave it out. */
  bookingLink?(restaurantId: string, phone: string, config: BookingConfig): Promise<string | null>
  now(): Date
  /** BOOK-010 F1 (review P2-1): counts and stops, so the alternatives fit; absent = rules-only alternatives. */
  room?: { reader: BookingRoomReader }
}

export interface RecheckMessage {
  restaurantId: string
  phone: string
}

export interface RecheckResult {
  /** The codes that still pass: the only ones to promote. */
  codes: string[]
  /** Candidates refused now (the code was ours, so the message is handled). */
  refused: number
}

async function linkFor(deps: RecheckAgentBookingsDeps, message: RecheckMessage, config: BookingConfig): Promise<string | null> {
  try {
    return (await deps.bookingLink?.(message.restaurantId, message.phone, config)) ?? null
  } catch (err) {
    console.warn('[AgentBooking] booking link not built:', (err as Error).name)
    return null
  }
}

async function refuse(deps: RecheckAgentBookingsDeps, row: AgentBooking, text: (link: string | null) => string, config: BookingConfig) {
  const link = await linkFor(deps, row, config)
  await deps.sendText(row.restaurantId, row.phone, text(link))
}

/** "Fits the party now" for a row's alternatives: one room read per message, only once a row is refused by the rules. */
function roomFitsFor(deps: RecheckAgentBookingsDeps, restaurantId: string, config: BookingConfig, at: Date) {
  const hours = config.bookingHours
  const reader = deps.room?.reader
  if (!reader || !roomApplies(hours)) return async () => undefined
  const today = hongKongToday(at)
  let room: Promise<RoomState> | null = null
  return async (partySize: number): Promise<SlotFits> => {
    room ??= reader.readRoom(restaurantId, today, windowEnd(hours, today))
    return fitsFor(hours, await room, partySize)
  }
}

export async function recheckAgentBookings(
  deps: RecheckAgentBookingsDeps,
  message: RecheckMessage & { codes: string[] },
  config: BookingConfig
): Promise<RecheckResult> {
  const at = deps.now()
  const rules = bookingRulesAt(at, config)
  const rows = await deps.store.findPromotable({ restaurantId: message.restaurantId, phone: message.phone, codes: message.codes, at })
  const result: RecheckResult = { codes: [], refused: 0 }
  const fitsOf = roomFitsFor(deps, message.restaurantId, config, at)
  for (const row of rows) {
    let check = recheckAgentBooking(row, rules)
    if (check.kind === 'rules') check = recheckAgentBooking(row, rules, await fitsOf(row.partySize))
    if (check.kind === 'ok') {
      if (row.confirmCode) result.codes.push(row.confirmCode)
      continue
    }
    result.refused += 1
    if (check.kind === 'terms') await refuse(deps, row, termsNowRequiredText, config)
    else if (await deps.store.declineUnverified(row.id, row.restaurantId, at, 'rules')) {
      await refuse(deps, row, (link) => timeUnavailableText(row, check.suggested, link), config)
    }
  }
  return result
}
