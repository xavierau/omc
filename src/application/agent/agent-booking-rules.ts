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
 */
import { suggestionsForRefusal } from '@/domain/services/agent-booking'
import { parseBookingSubmission, type BookingSubmission, type BookingSubmissionRules } from '@/domain/services/booking-submission'
import { termsSnapshot } from '@/domain/value-objects/booking-hours'
import type { AgentToolOutput } from '@/domain/ports/agent-model'
import { bookingRulesAt } from '@/application/booking/submit-booking-request'
import type { BookingCall } from './agent-booking-gate'

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

function parseWith(rules: BookingSubmissionRules, body: Record<string, unknown>, extra: AgentToolOutput): ParsedProposal {
  const parsed = parseBookingSubmission(body, rules)
  if (parsed.ok) return parsed
  const requested = { date: String(body.date), time: String(body.time), clock: rules }
  const suggested = suggestionsForRefusal(rules.hours, parsed.errors, requested)
  if (!suggested) return { ok: false, output: { error: 'invalid', fields: parsed.errors, ...extra } }
  const note = `${typeof extra.note === 'string' ? `${extra.note} ` : ''}${SUGGESTED_NOTE}`
  return { ok: false, output: { error: 'invalid', fields: parsed.errors, suggestedTimes: suggested, ...extra, note } }
}

/** A propose tool's check: the slot under the restaurant's hours; terms are read back, not yet accepted. */
export function parseProposal(call: BookingCall, body: Record<string, unknown>, extra: AgentToolOutput): ParsedProposal {
  return parseWith({ ...rulesFor(call), termsRequired: false }, body, extra)
}

/** A create/confirm tool's re-check: the diner agreed to the read-back, terms included. */
export function parseAgreed(
  call: BookingCall,
  proposal: { booking: BookingSubmission; termsText?: string },
  extra: AgentToolOutput
): ParsedProposal {
  if ((proposal.termsText ?? null) !== currentTerms(call)) return { ok: false, output: TERMS_CHANGED }
  const { date, time, partySize, name, notes } = proposal.booking
  return parseWith(rulesFor(call), { date, time, partySize, name, notes, acceptTerms: true }, extra)
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
