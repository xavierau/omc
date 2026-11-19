/**
 * AGENT-003: the reply agent's booking tools (threat R12–R17).
 *
 * - `propose_booking(date, time, partySize, name, notes?)` validates the
 *   details with BOOK-001's own `parseBookingSubmission` (R13) and stores ONE
 *   proposal for the job's `{restaurantId, phone}` (R15). It books nothing.
 * - `create_booking_request()` takes no arguments: it books exactly the stored
 *   proposal, only when a job EARLIER than this one made it (the diner wrote
 *   again after the read-back), unexpired and unused (consumed atomically).
 *   The row is a BOOK-001 **pending** request (R16) with source 'agent' (R17,
 *   "via AI agent" in 訂座), held to the per-phone open cap (R14), and the
 *   diner gets BOOK-001's "received" message, best effort.
 * - `get_booking_link()` returns the external booking URL.
 *
 * Which of them a tenant is offered follows its booking mode: simple →
 * propose + create, external → the link, off → none (threat Auth & Authz).
 * Identity is the job key only: no argument names a phone, restaurant,
 * member or booking (R12). Proposal values are never logged (R8).
 */
import { MAX_PENDING_PER_PHONE } from '@/domain/entities/booking-request'
import { parseBookingSubmission } from '@/domain/services/booking-submission'
import { AGENT_PROPOSAL_TTL_MS, type AgentProposalStore } from '@/domain/ports/agent-booking-proposal'
import type { AgentConversationKey } from '@/domain/ports/agent-reply'
import type { AgentToolDeclaration, AgentToolOutput } from '@/domain/ports/agent-model'
import type { AgentToolName } from '@/domain/value-objects/agent-config'
import type { BookingConfig, BookingMode } from '@/domain/value-objects/booking-config'
import type {
  BookingMemberLookup,
  BookingMessageSender,
  BookingRequestStore,
  BookingSettingsReader,
} from '@/domain/ports/booking'
import { bookingRulesAt, notifyReceived } from '@/application/booking/submit-booking-request'

export type AgentBookingToolName = Extract<AgentToolName, 'propose_booking' | 'create_booking_request' | 'get_booking_link'>
export const AGENT_BOOKING_TOOL_NAMES: readonly AgentBookingToolName[] = [
  'propose_booking',
  'create_booking_request',
  'get_booking_link',
]

const TOOLS_BY_MODE: Record<BookingMode, readonly AgentBookingToolName[]> = {
  off: [],
  simple: ['propose_booking', 'create_booking_request'],
  external: ['get_booking_link'],
}

export function isAgentBookingTool(name: AgentToolName): name is AgentBookingToolName {
  return (AGENT_BOOKING_TOOL_NAMES as readonly string[]).includes(name)
}

/** The booking tools a tenant's booking mode allows; null (unreadable config) = none. */
export function bookingToolsForMode(mode: BookingMode | null): readonly AgentBookingToolName[] {
  return mode ? TOOLS_BY_MODE[mode] : []
}

/** The only arguments propose_booking reads; anything else the model sends is dropped (R12). */
const PROPOSAL_FIELDS = ['date', 'time', 'partySize', 'name', 'notes'] as const

export const AGENT_BOOKING_TOOL_DECLARATIONS: Record<AgentBookingToolName, AgentToolDeclaration> = {
  propose_booking: {
    name: 'propose_booking',
    description:
      'Check the details of a table booking for the diner you are talking to, once you know the date, time, party size and the name for the booking. It books and reserves nothing (never say a table is held): read the returned details back to the diner and ask them to confirm. On field errors, ask the diner to correct those details.',
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
      'Send the booking you proposed with propose_booking to the restaurant, only after the diner has agreed to your read-back in a later message. Takes no arguments: it sends exactly the last proposal. The booking is a request: restaurant staff confirm or decline it and the diner gets a WhatsApp update.',
  },
  get_booking_link: {
    name: 'get_booking_link',
    description: "Get the restaurant's online booking link to share with a diner who wants to book a table. Takes no arguments.",
  },
}

export interface AgentBookingToolContext {
  /** The tenant's booking settings, read when the job started. */
  config: Pick<BookingConfig, 'mode' | 'maxPartySize' | 'externalUrl'>
  /** `created_at` of this job's inbound agent_messages row (R15); null when it is gone. */
  inboundCreatedAt(): Promise<string | null>
  proposals: AgentProposalStore
  requests: Pick<BookingRequestStore, 'insert' | 'countPending'>
  /** BOOK-003 unverified bookings still live for this phone (they count toward the cap, R14). */
  countLiveUnverified(restaurantId: string, now: Date, phone: string): Promise<number>
  members: BookingMemberLookup
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  sender: BookingMessageSender
}

interface Call {
  key: AgentConversationKey
  now: () => Date
  booking: AgentBookingToolContext
}

/** R14: pending requests plus live BOOK-003 unverified ones, as the BOOK-003 create path counts them. */
async function atOpenCap({ key, now, booking }: Call): Promise<boolean> {
  const [pending, unverified] = await Promise.all([
    booking.requests.countPending(key.restaurantId, key.phone),
    booking.countLiveUnverified(key.restaurantId, now(), key.phone),
  ])
  return pending + unverified >= MAX_PENDING_PER_PHONE
}

const TOO_MANY_PENDING: AgentToolOutput = {
  error: 'too_many_pending',
  note: 'The diner already has the most open booking requests allowed. Tell them staff will reply to those first.',
}

async function proposeBooking(call: Call, args: Record<string, unknown>): Promise<AgentToolOutput> {
  const { key, now, booking } = call
  const body = Object.fromEntries(PROPOSAL_FIELDS.filter((f) => args[f] !== undefined).map((f) => [f, args[f]]))
  const parsed = parseBookingSubmission(body, bookingRulesAt(now(), booking.config.maxPartySize))
  if (!parsed.ok) {
    return { error: 'invalid', fields: parsed.errors, maxPartySize: booking.config.maxPartySize, note: 'Ask the diner to correct these details.' }
  }
  if (await atOpenCap(call)) return TOO_MANY_PENDING
  const inboundCreatedAt = await booking.inboundCreatedAt()
  if (!inboundCreatedAt) return { error: 'lookup_failed' }
  await booking.proposals.save(key, { booking: parsed.submission, inboundCreatedAt, proposedAt: now().toISOString() }, AGENT_PROPOSAL_TTL_MS)
  return {
    proposed: true,
    booking: parsed.submission,
    note: 'Nothing is booked yet. Read these details back to the diner and ask them to confirm. Call create_booking_request only after they agree in their next message.',
  }
}

async function createBookingRequest(call: Call): Promise<AgentToolOutput> {
  const { key, now, booking } = call
  const inboundCreatedAt = await booking.inboundCreatedAt()
  if (!inboundCreatedAt) return { error: 'lookup_failed' }
  const taken = await booking.proposals.takeIfEarlier(key, inboundCreatedAt)
  if (taken.kind === 'not_earlier') {
    return { error: 'awaiting_diner_confirmation', note: 'Read the proposed booking back to the diner and wait for their reply before creating it.' }
  }
  const at = now()
  if (taken.kind === 'none' || at.getTime() - Date.parse(taken.proposal.proposedAt) > AGENT_PROPOSAL_TTL_MS) {
    return { error: 'no_proposal', note: 'There is no booking waiting for confirmation. Collect the details and call propose_booking first.' }
  }
  // Re-checked now: the proposed time may have passed while the diner answered.
  const parsed = parseBookingSubmission({ ...taken.proposal.booking }, bookingRulesAt(at, booking.config.maxPartySize))
  if (!parsed.ok) return { error: 'invalid', fields: parsed.errors, note: 'Ask the diner for new details and propose again.' }
  if (await atOpenCap(call)) return TOO_MANY_PENDING

  const s = parsed.submission
  const memberId = await booking.members.findMemberId(key.restaurantId, key.phone)
  const created = await booking.requests.insert({
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
  })
  // R16: best effort; a failed "received" message never fails the booking.
  await notifyReceived(booking, created).catch(() => false)
  return {
    booked: true,
    status: 'pending',
    note: 'The request is sent. Tell the diner the restaurant will confirm it and they will get a WhatsApp message.',
  }
}

function bookingLink({ booking }: Call): AgentToolOutput {
  const url = booking.config.mode === 'external' ? booking.config.externalUrl : null
  return url ? { url, note: 'Share this link so the diner can book.' } : { error: 'no_booking_link' }
}

export async function runBookingTool(name: AgentBookingToolName, call: Call, args: Record<string, unknown>): Promise<AgentToolOutput> {
  switch (name) {
    case 'propose_booking':
      return proposeBooking(call, args)
    case 'create_booking_request':
      return createBookingRequest(call)
    case 'get_booking_link':
      return bookingLink(call)
  }
}
