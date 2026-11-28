/**
 * BOOK-009 W4 (spec AC-16, AC-17): how the AI booking tools apply the
 * restaurant's booking hours and terms. Slot checks stay in W1's shared
 * parser (`bookingRulesAt` + `parseBookingSubmission`); this module decides
 * only WHEN the terms count as accepted, and shapes refusals.
 *
 * - propose: the slot must be bookable now; the terms are not accepted yet
 *   (the tool returns them for the read-back), so this parse does not
 *   require them. A slot the hours refuse comes back with `suggestedTimes`.
 * - create / confirm: the diner's agreeing message is the acceptance, so the
 *   stored proposal is re-parsed with `acceptTerms: true`. It must carry the
 *   same terms text that was read back; changed terms → `terms_changed`.
 *
 * BOOK-010 (spec AC-4, AC-7): when room rules apply, a propose tool answers
 * `full` early (fields.time full + suggestedTimes that fit), and create /
 * confirm write through the atomic check-and-insert, so a slot that filled
 * while the diner answered comes back `full` and nothing is created.
 */
import { isHoursRefusal, suggestionsForRefusal } from '@/domain/services/agent-booking'
import {
  parseBookingSubmission,
  type BookingFieldErrors,
  type BookingSubmission,
  type BookingSubmissionRules,
} from '@/domain/services/booking-submission'
import { termsSnapshot } from '@/domain/value-objects/booking-hours'
import type { AgentToolOutput } from '@/domain/ports/agent-model'
import { bookingRulesAt } from '@/application/booking/submit-booking-request'
import type { BookingCall } from './agent-booking-gate'
import type { BookingRequest, NewBookingRequest } from '@/domain/entities/booking-request'
import { roomApplies, roomCheckFor, type RoomCheck, type RoomRefusal, type SlotFits } from '@/domain/services/booking-room'
import { hongKongTime, hongKongToday } from '@/domain/services/booking-submission'
import type { BookingRoomStore } from '@/domain/ports/booking'
import {
  earlyFull,
  fittingSuggestions,
  insertWithRoom,
  suggestionFits,
  suggestionParty,
  type FullRefusal,
  type RoomContext,
} from '@/application/booking/booking-room-check'

export type ParsedProposal = { ok: true; submission: BookingSubmission } | { ok: false; output: AgentToolOutput }

const SUGGESTED_NOTE =
  'The restaurant does not take the requested time: offer the diner these suggestedTimes (or ask for another time); never propose or book the refused time.'

const TERMS_CHANGED: AgentToolOutput = {
  error: 'terms_changed',
  note: "The restaurant's booking terms changed after your read-back. Propose again and read the new terms back to the diner.",
}

function rulesFor(call: BookingCall): BookingSubmissionRules {
  const { maxPartySize, bookingHours } = call.booking.config
  return bookingRulesAt(call.now(), { maxPartySize, bookingHours: bookingHours ?? null })
}

/** The terms a diner must accept now (W1 snapshot: both set languages, zh-HK first); null = none. */
export function currentTerms(call: BookingCall): string | null {
  return termsSnapshot(call.booking.config.bookingHours ?? null)
}

/** BOOK-010 F1 (review P2-1): alternatives to a slot the hours refuse fit the party too, when room rules apply. */
async function refusalFits(call: BookingCall, errors: BookingFieldErrors, body: Record<string, unknown>): Promise<SlotFits | undefined> {
  const ctx = roomContext(call)
  if (!ctx || !isHoursRefusal(errors)) return undefined
  return suggestionFits(ctx.store, ctx, { date: String(body.date), partySize: suggestionParty(body.partySize) })
}

async function parseWith(
  call: BookingCall,
  rules: BookingSubmissionRules,
  body: Record<string, unknown>,
  extra: AgentToolOutput
): Promise<ParsedProposal> {
  const parsed = parseBookingSubmission(body, rules)
  if (parsed.ok) return parsed
  const fits = await refusalFits(call, parsed.errors, body)
  const requested = { date: String(body.date), time: String(body.time), clock: rules, fits }
  const suggested = suggestionsForRefusal(rules.hours, parsed.errors, requested)
  if (!suggested) return { ok: false, output: { error: 'invalid', fields: parsed.errors, ...extra } }
  const note = `${typeof extra.note === 'string' ? `${extra.note} ` : ''}${SUGGESTED_NOTE}`
  return { ok: false, output: { error: 'invalid', fields: parsed.errors, suggestedTimes: suggested, ...extra, note } }
}

/** A propose tool's check: the slot under the restaurant's hours; terms are read back, not yet accepted. */
export function parseProposal(call: BookingCall, body: Record<string, unknown>, extra: AgentToolOutput): Promise<ParsedProposal> {
  return parseWith(call, { ...rulesFor(call), termsRequired: false }, body, extra)
}

/** A create/confirm tool's re-check: the diner agreed to the read-back, terms included. */
export function parseAgreed(
  call: BookingCall,
  proposal: { booking: BookingSubmission; termsText?: string },
  extra: AgentToolOutput
): Promise<ParsedProposal> {
  if ((proposal.termsText ?? null) !== currentTerms(call)) return Promise.resolve({ ok: false, output: TERMS_CHANGED })
  const { date, time, partySize, name, notes } = proposal.booking
  return parseWith(call, rulesFor(call), { date, time, partySize, name, notes, acceptTerms: true }, extra)
}

/** BOOK-009 AC-10/AC-17: when, and the exact text, of terms the diner accepted in chat (stored on the row, source agent). */
export function acceptedTerms(call: BookingCall, s: BookingSubmission): { termsAcceptedAt?: string; termsText?: string } {
  const text = s.termsAccepted ? currentTerms(call) : null
  return text ? { termsAcceptedAt: call.now().toISOString(), termsText: text } : {}
}

/** The ok-result fields and proposal field for the read-back; empty when the restaurant has no terms. */
export function termsForReadBack(call: BookingCall): { terms?: string; note?: string } {
  const terms = currentTerms(call)
  return terms
    ? { terms, note: 'Also read the booking terms back ("請注意: …"); the diner agreeing to your read-back accepts them.' }
    : {}
}

const FULL_NOTE =
  'That time is full (or the restaurant stopped taking bookings for it): tell the diner and offer these suggestedTimes, or ask for another time; never propose or book the full time.'

const fullOutput = (full: FullRefusal): AgentToolOutput => ({
  error: 'invalid', fields: full.errors, suggestedTimes: full.suggestedTimes, note: FULL_NOTE,
})

function roomContext(call: BookingCall): (RoomContext & { store: BookingRoomStore }) | null {
  const hours = call.booking.config.bookingHours
  if (!call.booking.room || !roomApplies(hours)) return null
  const now = call.now()
  return { restaurantId: call.key.restaurantId, hours, clock: { today: hongKongToday(now), nowTime: hongKongTime(now) }, store: call.booking.room }
}

/** BOOK-010 (spec AC-4): a propose tool's early room check; null when the party fits (or no room rules). */
export async function proposalFull(call: BookingCall, s: BookingSubmission): Promise<AgentToolOutput | null> {
  const ctx = roomContext(call)
  const full = ctx ? await earlyFull(ctx.store, ctx, { date: s.date, time: s.time, partySize: s.partySize }) : null
  return full ? fullOutput(full) : null
}

/** BOOK-010 (spec AC-5, AC-7): create / confirm-change write; through the atomic check-and-insert when room rules apply. */
export async function insertRequest(
  call: BookingCall,
  request: NewBookingRequest
): Promise<{ ok: true; booking: BookingRequest } | { ok: false; output: AgentToolOutput }> {
  const ctx = roomContext(call)
  if (!ctx) return { ok: true, booking: await call.booking.requests.insert(request) }
  const inserted = await insertWithRoom(ctx.store, ctx, request)
  return inserted.ok ? inserted : { ok: false, output: fullOutput(inserted.full) }
}

/** No guest limits: the deposit insert then checks only the per-phone cap (as the booking page, W3). */
const NO_ROOM_LIMITS: RoomCheck = { periodKey: null, periodFirst: null, periodLast: null, perSlot: null, perMeal: null }

/**
 * BOOK-014 W5 (spec AC-9): what the atomic booking + deposit insert checks for
 * this slot (the room rules when they apply), and how its refusal is answered
 * (the same `full` + suggestedTimes as insertRequest).
 */
export function depositInsertCheck(call: BookingCall, request: NewBookingRequest) {
  const ctx = roomContext(call)
  const check = ctx ? roomCheckFor(ctx.hours, request.bookingDate, request.bookingTime) : NO_ROOM_LIMITS
  return {
    check,
    async full(refusal: RoomRefusal): Promise<AgentToolOutput> {
      const req = { date: request.bookingDate, time: request.bookingTime, partySize: request.partySize }
      const suggestedTimes = ctx ? await fittingSuggestions(ctx.store, ctx, req) : []
      return fullOutput({ errors: { time: 'full' }, suggestedTimes, refusal })
    },
  }
}
