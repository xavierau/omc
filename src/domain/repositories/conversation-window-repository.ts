import type { ConversationWindow } from '../entities/conversation-window'

export interface FindOpenArgs {
  restaurantId: string
  phoneE164: string
  /** Defaults to `new Date()`. Pass for time-based tests / replay logic. */
  at?: Date
}

export interface BulkIsOpenArgs {
  restaurantId: string
  phones: string[]
  at?: Date
}

/**
 * Contract for the `conversation_windows` writer/reader. The Supabase
 * implementation lives in `src/infrastructure/supabase/repositories/`
 * and is the SOLE writer to the table (service role bypasses RLS).
 *
 * Append-history semantics: closed windows are NOT deleted. Cleanup is
 * a separate ops follow-up. "Open" is materialised on read by
 * `expires_at > at`.
 */
export interface ConversationWindowRepository {
  /**
   * Returns the most-recent open window for (restaurantId, phoneE164),
   * or null if none is currently open.
   */
  findOpen(args: FindOpenArgs): Promise<ConversationWindow | null>

  /**
   * Idempotent upsert. If an open window exists, returns a bumped
   * version (advances last_inbound_at + expires_at). Otherwise inserts
   * the supplied "freshly opened" window. Returns the persisted entity.
   */
  upsertOpen(window: ConversationWindow): Promise<ConversationWindow>

  /** Convenience predicate. Equivalent to `findOpen(...) !== null`. */
  isOpen(args: FindOpenArgs): Promise<boolean>

  /**
   * Bulk variant for analytics/cooldown attribution. Returns the subset
   * of `phones` that currently have an open window for this tenant.
   * Empty input short-circuits.
   */
  bulkIsOpen(args: BulkIsOpenArgs): Promise<Set<string>>
}
