/**
 * AGENT-003 R15/R22: what the agent proposed to a diner (a new booking, a
 * change or a cancel), held until the diner answers in a LATER message
 * (two-step gate).
 *
 * One proposal per `{restaurantId, phone}` across all kinds (a new proposal
 * replaces the old one), kept for `AGENT_PROPOSAL_TTL_MS`, consumed
 * atomically: `takeIfEarlier` hands it out once, only for the expected kind,
 * and only to a job whose inbound row is newer than the one of the job that
 * proposed it. The key comes from the job, never from the model (R12).
 *
 * Review F1: a proposal is stored by one worker run (its `owner`) and is NOT
 * confirmable until that run marks it so, which it does only once its
 * read-back reached the diner (auto: the reply was sent; shadow: the draft was
 * stored, OR5). Every other outcome discards it. `peekKind` and
 * `takeIfEarlier` see confirmable proposals only.
 * Proposal values are PII: never logged (AGENT-001 R8).
 */
import type { BookingSubmission } from '@/domain/services/booking-submission'
import type { AgentConversationKey } from './agent-reply'

export const AGENT_PROPOSAL_TTL_MS = 30 * 60_000

export type AgentProposalKind = 'create' | 'change' | 'cancel'

/**
 * create: a new booking · change: new values for `bookingId` · cancel: `bookingId`.
 * BOOK-009: `termsText` = the booking terms read back with the proposal
 * (absent when the restaurant had none); the diner's agreement accepts them.
 * BOOK-014 W6-fix F5: `plannedDeposit` = the deposit read back with a create
 * proposal (null = none). The diner agreed to exactly that; create refuses and
 * re-proposes when it changed. Absent on a proposal stored before W6-fix.
 */
export type AgentProposalAction =
  | { kind: 'create'; booking: BookingSubmission; termsText?: string; plannedDeposit?: { amountMinor: number; currency: string } | null }
  | { kind: 'change'; bookingId: string; booking: BookingSubmission; termsText?: string }
  | { kind: 'cancel'; bookingId: string }

export type AgentBookingProposal = AgentProposalAction & {
  /** `created_at` of the inbound agent_messages row of the job that proposed it. */
  inboundCreatedAt: string
  proposedAt: string
}

/**
 * - `taken`: the proposal, now deleted (single use);
 * - `none`: no proposal, or it expired;
 * - `not_earlier`: the proposal was made by this job (or a newer one); it stays stored;
 * - `other_kind`: the stored proposal is of another kind; it stays stored.
 */
export type TakeProposalResult =
  | { kind: 'taken'; proposal: AgentBookingProposal }
  | { kind: 'none' }
  | { kind: 'not_earlier' }
  | { kind: 'other_kind' }

export interface AgentProposalStore {
  /** Stores or replaces the conversation's proposal for `ttlMs`, owned by run `owner`, not confirmable. */
  save(key: AgentConversationKey, proposal: AgentBookingProposal, ttlMs: number, owner: string): Promise<void>
  /** Makes the stored proposal confirmable if `owner` still owns it; true when it did. */
  markConfirmable(key: AgentConversationKey, owner: string): Promise<boolean>
  /** Deletes the stored proposal if `owner` still owns it (a newer run's proposal stays). */
  discard(key: AgentConversationKey, owner: string): Promise<void>
  /**
   * The kind of the conversation's live CONFIRMABLE proposal, or null. Only the kind: the
   * worker tells the model a read-back is waiting (history rows keep no tool
   * results, R9), never its values. Reading it consumes and authorises nothing.
   */
  peekKind(key: AgentConversationKey): Promise<AgentProposalKind | null>
  /**
   * Atomic check-and-delete: hands the proposal out only when it is of `kind`,
   * its inbound row is older than `inboundCreatedAt` and it is confirmable. A
   * proposal of this job stays (`not_earlier`); one never confirmable is `none`.
   */
  takeIfEarlier(key: AgentConversationKey, inboundCreatedAt: string, kind: AgentProposalKind): Promise<TakeProposalResult>
}
