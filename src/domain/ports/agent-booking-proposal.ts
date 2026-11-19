/**
 * AGENT-003 R15: the booking the agent proposed to a diner, held until the
 * diner answers in a LATER message (two-step gate).
 *
 * One proposal per `{restaurantId, phone}` (a new proposal replaces the old
 * one), kept for `AGENT_PROPOSAL_TTL_MS`, consumed atomically: `takeIfEarlier`
 * hands it out once, and only to a job whose inbound row is newer than the
 * one of the job that proposed it. The key comes from the job, never from the
 * model (R12). Proposal values are PII: never logged (AGENT-001 R8).
 */
import type { BookingSubmission } from '@/domain/services/booking-submission'
import type { AgentConversationKey } from './agent-reply'

export const AGENT_PROPOSAL_TTL_MS = 30 * 60_000

export interface AgentBookingProposal {
  booking: BookingSubmission
  /** `created_at` of the inbound agent_messages row of the job that proposed it. */
  inboundCreatedAt: string
  proposedAt: string
}

/**
 * - `taken`: the proposal, now deleted (single use);
 * - `none`: no proposal, or it expired;
 * - `not_earlier`: the proposal was made by this job (or a newer one); it stays stored.
 */
export type TakeProposalResult =
  | { kind: 'taken'; proposal: AgentBookingProposal }
  | { kind: 'none' }
  | { kind: 'not_earlier' }

export interface AgentProposalStore {
  /** Stores or replaces the conversation's proposal for `ttlMs`. */
  save(key: AgentConversationKey, proposal: AgentBookingProposal, ttlMs: number): Promise<void>
  /** Atomic check-and-delete: hands the proposal out only when its inbound row is older than `inboundCreatedAt`. */
  takeIfEarlier(key: AgentConversationKey, inboundCreatedAt: string): Promise<TakeProposalResult>
}
