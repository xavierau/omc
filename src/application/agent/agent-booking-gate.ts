/**
 * AGENT-003: what every booking tool shares: the tool context, the open
 * request cap (R14) and the two-step gate (R15, R22).
 *
 * The gate: a confirm tool takes the conversation's stored proposal only when
 * it is of the expected kind, was stored by an EARLIER job than this one (the
 * diner wrote again after the read-back), is under 30 minutes old and unused;
 * the take is atomic, so it is single use. Review F1: and only when it is
 * CONFIRMABLE, i.e. the proposing job's read-back actually reached the diner
 * (the worker marks it; see process-agent-reply.ts).
 */
import { MAX_PENDING_PER_PHONE } from '@/domain/entities/booking-request'
import { hongKongTime, hongKongToday } from '@/domain/services/booking-submission'
import {
  AGENT_PROPOSAL_TTL_MS,
  type AgentBookingProposal,
  type AgentProposalAction,
  type AgentProposalKind,
  type AgentProposalStore,
} from '@/domain/ports/agent-booking-proposal'
import type { AgentConversationKey } from '@/domain/ports/agent-reply'
import type { AgentToolOutput } from '@/domain/ports/agent-model'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type {
  BookingMemberLookup,
  BookingMessageSender,
  BookingRequestStore,
  BookingSettingsReader,
  DinerBookingStore,
  HongKongMoment,
} from '@/domain/ports/booking'

export interface AgentBookingToolContext {
  /**
   * The tenant's booking settings, read when the job started (AGENT-005: bookingRules feeds the booking skill's prompt;
   * BOOK-009: bookingHours binds the tools, absent = null = any time).
   */
  config: Pick<BookingConfig, 'mode' | 'maxPartySize' | 'externalUrl' | 'bookingRules'> & Partial<Pick<BookingConfig, 'bookingHours'>>
  /** `created_at` of this job's inbound agent_messages row (R15); null when it is gone. */
  inboundCreatedAt(): Promise<string | null>
  proposals: AgentProposalStore
  /**
   * Review F1: this run's id. A proposal is stored under it, NOT confirmable;
   * the worker makes it confirmable only once this run's read-back reached
   * the diner, and discards it on any other outcome.
   */
  proposalOwner: string
  /** R11: the tenant's disclosure, appended to a text a tool sends (review F9). */
  disclosureText: string
  requests: Pick<BookingRequestStore, 'insert' | 'countPending'>
  /** BOOK-003 unverified bookings still live for this phone (they count toward the cap, R14). */
  countLiveUnverified(restaurantId: string, now: Date, phone: string): Promise<number>
  members: BookingMemberLookup
  settings: Pick<BookingSettingsReader, 'getRestaurant'>
  sender: BookingMessageSender
  /** R20/R21/R24: the diner's own bookings, scoped by restaurant AND phone. */
  diner: DinerBookingStore
  /** R24: a free-form text inside the open service window; true when it went out. */
  notifyText(restaurantId: string, phone: string, text: string): Promise<boolean>
}

export interface BookingCall {
  key: AgentConversationKey
  now: () => Date
  booking: AgentBookingToolContext
}

/** R20/R24 (review F10): the Hong Kong date and HH:MM now; earlier today is past. */
export const hkNow = (call: BookingCall): HongKongMoment => {
  const now = call.now()
  return { date: hongKongToday(now), time: hongKongTime(now) }
}

/** R14: pending requests plus live BOOK-003 unverified ones, as the BOOK-003 create path counts them. */
export async function atOpenCap({ key, now, booking }: BookingCall): Promise<boolean> {
  const [pending, unverified] = await Promise.all([
    booking.requests.countPending(key.restaurantId, key.phone),
    booking.countLiveUnverified(key.restaurantId, now(), key.phone),
  ])
  return pending + unverified >= MAX_PENDING_PER_PHONE
}

export const TOO_MANY_PENDING: AgentToolOutput = {
  error: 'too_many_pending',
  note: 'The diner already has the most open booking requests allowed. Tell them staff will reply to those first.',
}

/**
 * Stores the proposal for this conversation (replacing any other kind), owned
 * by this run and not yet confirmable (F1); false when the job's inbound row is gone.
 */
export async function saveProposal(call: BookingCall, action: AgentProposalAction): Promise<boolean> {
  const inboundCreatedAt = await call.booking.inboundCreatedAt()
  if (!inboundCreatedAt) return false
  const proposal: AgentBookingProposal = { ...action, inboundCreatedAt, proposedAt: call.now().toISOString() }
  await call.booking.proposals.save(call.key, proposal, AGENT_PROPOSAL_TTL_MS, call.booking.proposalOwner)
  return true
}

type Taken<K extends AgentProposalKind> = Extract<AgentBookingProposal, { kind: K }>

/** R15/R22: the stored proposal of `kind`, consumed; or the tool output that refuses. */
export async function takeProposal<K extends AgentProposalKind>(
  call: BookingCall,
  kind: K
): Promise<{ ok: true; proposal: Taken<K> } | { ok: false; output: AgentToolOutput }> {
  const inboundCreatedAt = await call.booking.inboundCreatedAt()
  if (!inboundCreatedAt) return { ok: false, output: { error: 'lookup_failed' } }
  const taken = await call.booking.proposals.takeIfEarlier(call.key, inboundCreatedAt, kind)
  if (taken.kind === 'not_earlier') {
    return {
      ok: false,
      output: {
        error: 'awaiting_diner_confirmation',
        note: 'The proposal was made in this turn, so the diner has not agreed to it yet. Do not call a confirm tool again now: read it back and ask the diner to confirm.',
      },
    }
  }
  if (taken.kind === 'taken' && call.now().getTime() - Date.parse(taken.proposal.proposedAt) <= AGENT_PROPOSAL_TTL_MS) {
    return { ok: true, proposal: taken.proposal as Taken<K> }
  }
  return {
    ok: false,
    output: { error: 'no_proposal', note: 'Nothing of this kind is waiting for the diner’s confirmation. Propose it first.' },
  }
}
