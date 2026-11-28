/**
 * AGENT-003: the reply agent's booking tools (threat R12–R17, R20–R24).
 *
 * New booking:
 * - `propose_booking(date, time, partySize, name, notes?)` validates the
 *   details with BOOK-001's own `parseBookingSubmission` (R13) and stores ONE
 *   proposal for the job's `{restaurantId, phone}` (R15). It books nothing.
 * - `create_booking_request()` takes no arguments: it books exactly the stored
 *   proposal through the two-step gate (agent-booking-gate.ts). The row is a
 *   BOOK-001 **pending** request (R16) with source 'agent' (R17, "via AI
 *   agent" in 訂座), held to the per-phone open cap (R14), and the diner gets
 *   BOOK-001's "received" message, best effort.
 * - `get_booking_link()` returns the external booking URL.
 * Change and cancel (R20–R24): agent-booking-change-tools.ts.
 *
 * Which tools a tenant is offered follows its booking mode: simple → every
 * booking tool but the link, external → the link, off → none (threat Auth &
 * Authz); a shadow run gets no change/cancel tool (review F2). Identity is the job key only: no argument names a phone,
 * restaurant or member; the one id the model passes is the change/cancel
 * `bookingRef`, resolved inside the diner's own bookings (R21). Proposal
 * values are never logged (R8).
 *
 * BOOK-009 W4 (spec AC-16, AC-17): the restaurant's booking hours and terms
 * bind both steps (agent-booking-rules.ts): a refused slot returns
 * `suggestedTimes` and stores nothing; the terms come back with the
 * proposal for the read-back and are stored as accepted on create.
 */
import type { AgentToolDeclaration, AgentToolOutput } from '@/domain/ports/agent-model'
import type { AgentMode, AgentToolName } from '@/domain/value-objects/agent-config'
import type { BookingMode } from '@/domain/value-objects/booking-config'
import { notifyReceived } from '@/application/booking/submit-booking-request'
import { atOpenCap, saveProposal, takeProposal, TOO_MANY_PENDING, type BookingCall } from './agent-booking-gate'
import { acceptedTerms, insertRequest, parseAgreed, parseProposal, proposalFull, termsForReadBack } from './agent-booking-rules'
import {
  CHANGE_TOOL_DECLARATIONS,
  CHANGE_TOOL_NAMES,
  runChangeTool,
  type AgentChangeToolName,
} from './agent-booking-change-tools'

export type { AgentBookingToolContext } from './agent-booking-gate'

/** The effective mode a run answers in (off never reaches the tools). */
export type AgentRunMode = Exclude<AgentMode, 'off'>

type NewBookingToolName = Extract<AgentToolName, 'propose_booking' | 'create_booking_request' | 'get_booking_link'>
export type AgentBookingToolName = NewBookingToolName | AgentChangeToolName
export const AGENT_BOOKING_TOOL_NAMES: readonly AgentBookingToolName[] = [
  'propose_booking',
  'create_booking_request',
  'get_booking_link',
  ...CHANGE_TOOL_NAMES,
]

const TOOLS_BY_MODE: Record<BookingMode, readonly AgentBookingToolName[]> = {
  off: [],
  simple: ['propose_booking', 'create_booking_request', ...CHANGE_TOOL_NAMES],
  external: ['get_booking_link'],
}

/**
 * Review F2: shadow never changes or cancels a booking. The owner accepted
 * that shadow CREATES pending requests (OR5) and nothing more; listing stays.
 */
const NOT_IN_SHADOW: readonly AgentBookingToolName[] = [
  'propose_booking_change',
  'confirm_booking_change',
  'propose_booking_cancel',
  'confirm_booking_cancel',
]

/** The tools that store a proposal; any of them makes the worker offer the WAITING line (review F5). */
export const PROPOSING_TOOLS: readonly AgentBookingToolName[] = ['propose_booking', 'propose_booking_change', 'propose_booking_cancel']

export function isAgentBookingTool(name: AgentToolName): name is AgentBookingToolName {
  return (AGENT_BOOKING_TOOL_NAMES as readonly string[]).includes(name)
}

/** The booking tools a tenant's booking mode allows in this run's agent mode; null (unreadable config) = none. */
export function bookingToolsForMode(mode: BookingMode | null, agentMode: AgentRunMode): readonly AgentBookingToolName[] {
  const tools = mode ? TOOLS_BY_MODE[mode] : []
  return agentMode === 'shadow' ? tools.filter((t) => !NOT_IN_SHADOW.includes(t)) : tools
}

/** The only arguments propose_booking reads; anything else the model sends is dropped (R12). */
const PROPOSAL_FIELDS = ['date', 'time', 'partySize', 'name', 'notes'] as const

export const AGENT_BOOKING_TOOL_DECLARATIONS: Record<AgentBookingToolName, AgentToolDeclaration> = {
  propose_booking: {
    name: 'propose_booking',
    description:
      'Check the details of a NEW table booking for the diner you are talking to, once you know the date, time, party size and the name for the booking. It books and reserves nothing (never say a table is held): read the returned details back to the diner and ask them to confirm. On field errors, ask the diner to correct those details.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Booking date in Hong Kong as YYYY-MM-DD, today or later.' },
        time: { type: 'string', description: 'Arrival time as HH:MM, 24-hour clock.' },
        partySize: { type: 'integer', description: 'Number of people.' },
        name: { type: 'string', description: 'Name the booking is under, as the diner gave it.' },
        notes: { type: 'string', description: 'Optional special requests the diner gave, in their words.' },
      },
      required: ['date', 'time', 'partySize', 'name'],
    },
  },
  create_booking_request: {
    name: 'create_booking_request',
    description:
      'Send the booking you proposed with propose_booking to the restaurant, only after the diner has agreed to your read-back in a later message. When the diner\'s message agrees, call this directly: do not propose again (proposing again restarts the confirmation). Takes no arguments: it sends exactly the last proposal. The booking is a request: restaurant staff confirm or decline it and the diner gets a WhatsApp update.',
  },
  get_booking_link: {
    name: 'get_booking_link',
    description: "Get the restaurant's online booking link to share with a diner who wants to book a table. Takes no arguments.",
  },
  ...CHANGE_TOOL_DECLARATIONS,
}

const PROPOSED_NOTE =
  'Nothing is booked yet. Read these details back to the diner and ask them to confirm. Call create_booking_request only after they agree in their next message.'

async function proposeBooking(call: BookingCall, args: Record<string, unknown>): Promise<AgentToolOutput> {
  const { booking } = call
  const body = Object.fromEntries(PROPOSAL_FIELDS.filter((f) => args[f] !== undefined).map((f) => [f, args[f]]))
  const parsed = await parseProposal(call, body, { maxPartySize: booking.config.maxPartySize, note: 'Ask the diner to correct these details.' })
  if (!parsed.ok) return parsed.output
  const full = await proposalFull(call, parsed.submission)
  if (full) return full
  if (await atOpenCap(call)) return TOO_MANY_PENDING
  const { terms, note } = termsForReadBack(call)
  if (!(await saveProposal(call, { kind: 'create', booking: parsed.submission, ...(terms ? { termsText: terms } : {}) }))) {
    return { error: 'lookup_failed' }
  }
  return {
    proposed: true,
    booking: parsed.submission,
    ...(terms ? { terms } : {}),
    note: note ? `${PROPOSED_NOTE} ${note}` : PROPOSED_NOTE,
  }
}

async function createBookingRequest(call: BookingCall): Promise<AgentToolOutput> {
  const { key, booking } = call
  const taken = await takeProposal(call, 'create')
  if (!taken.ok) return taken.output
  // Re-checked now: the proposed time may have passed (or left the hours) while the diner answered.
  const parsed = await parseAgreed(call, taken.proposal, { note: 'Ask the diner for new details and propose again.' })
  if (!parsed.ok) return parsed.output
  if (await atOpenCap(call)) return TOO_MANY_PENDING

  const s = parsed.submission
  const memberId = await booking.members.findMemberId(key.restaurantId, key.phone)
  const inserted = await insertRequest(call, {
    restaurantId: key.restaurantId,
    memberId,
    phone: key.phone,
    name: s.name,
    partySize: s.partySize,
    bookingDate: s.date,
    bookingTime: s.time,
    notes: s.notes,
    source: 'agent',
    campaignId: null,
    token: null,
    ...acceptedTerms(call, s),
  })
  if (!inserted.ok) return inserted.output
  // R16: best effort; a failed "received" message never fails the booking.
  await notifyReceived(booking, inserted.booking).catch(() => false)
  return {
    booked: true,
    status: 'pending',
    note: 'The request is sent. Tell the diner the restaurant will confirm it and they will get a WhatsApp message.',
  }
}

function bookingLink({ booking }: BookingCall): AgentToolOutput {
  const url = booking.config.mode === 'external' ? booking.config.externalUrl : null
  return url ? { url, note: 'Share this link so the diner can book.' } : { error: 'no_booking_link' }
}

export async function runBookingTool(name: AgentBookingToolName, call: BookingCall, args: Record<string, unknown>): Promise<AgentToolOutput> {
  switch (name) {
    case 'propose_booking':
      return proposeBooking(call, args)
    case 'create_booking_request':
      return createBookingRequest(call)
    case 'get_booking_link':
      return bookingLink(call)
    default:
      return runChangeTool(name, call, args)
  }
}
