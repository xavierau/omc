// INVARIANT (WAQ-008): the SOLE writer to `conversation_windows`.
// `createServerSupabaseClient()` uses SUPABASE_SERVICE_ROLE_KEY which bypasses
// RLS — there are no INSERT/UPDATE policies by design. Do NOT add a
// browser-side write path; route every mutation through this module.
// Mirrors `whatsapp-message-repository.ts` / `quality-state-repository.ts`.

import { createServerSupabaseClient } from '../client'
import { ConversationWindow } from '@/domain/entities/conversation-window'
import type {
  BulkIsOpenArgs,
  ConversationWindowRepository,
  FindOpenArgs,
} from '@/domain/repositories/conversation-window-repository'
import {
  toEntity,
  toInsertRow,
  type ConversationWindowRow,
} from './conversation-window-mapper'

const TABLE = 'conversation_windows'
const PG_UNIQUE_VIOLATION = '23505'

export async function findOpenWindow(
  args: FindOpenArgs
): Promise<ConversationWindow | null> {
  const supabase = createServerSupabaseClient()
  const at = (args.at ?? new Date()).toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', args.restaurantId)
    .eq('phone_e164', args.phoneE164)
    .gt('expires_at', at)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findOpenWindow: ${error.message}`)
  if (!data) return null
  return toEntity(data as ConversationWindowRow)
}

/**
 * Find-then-bump-or-insert. Concurrent duplicate webhooks (Meta retries,
 * same `opened_at`) collide on the unique index and raise 23505 — handled
 * by `insertFresh` re-running the find+bump path. Distinct-millisecond
 * races simply produce two rows; the read query (`expires_at > now()`
 * ORDER BY expires_at DESC LIMIT 1) always returns the most-recent.
 */
export async function upsertOpenWindow(
  fresh: ConversationWindow
): Promise<ConversationWindow> {
  const s = fresh.snapshot
  const now = new Date(s.lastInboundAt)
  const existing = await findOpenWindow({
    restaurantId: s.restaurantId,
    phoneE164: s.phoneE164,
    at: now,
  })
  if (existing) return bumpExisting(existing, now)
  return insertFresh(fresh)
}

async function bumpExisting(
  existing: ConversationWindow,
  now: Date
): Promise<ConversationWindow> {
  const bumped = existing.bumpInbound(now)
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from(TABLE)
    .update({
      last_inbound_at: bumped.snapshot.lastInboundAt,
      expires_at: bumped.snapshot.expiresAt,
    })
    .eq('id', bumped.snapshot.id)
  if (error) throw new Error(`upsertOpenWindow: ${error.message}`)
  return bumped
}

async function insertFresh(
  fresh: ConversationWindow
): Promise<ConversationWindow> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.from(TABLE).insert(toInsertRow(fresh))
  if (!error) return fresh
  // Concurrent duplicate webhook (Meta retry → same `opened_at`) lost the
  // race against the unique index. The winner's row is now visible —
  // re-run find+bump so this inbound still advances the window. Mirrors
  // WAQ-002's `tryMarkProcessed` 23505 fall-through.
  if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
    return reconcileAfterUniqueViolation(fresh)
  }
  throw new Error(`upsertOpenWindow: ${error.message}`)
}

async function reconcileAfterUniqueViolation(
  fresh: ConversationWindow
): Promise<ConversationWindow> {
  const s = fresh.snapshot
  const at = new Date(s.lastInboundAt)
  const existing = await findOpenWindow({
    restaurantId: s.restaurantId,
    phoneE164: s.phoneE164,
    at,
  })
  if (!existing) throw new Error('upsertOpenWindow: 23505 raised but no open window found on retry')
  return bumpExisting(existing, at)
}

export async function isWindowOpen(args: FindOpenArgs): Promise<boolean> {
  return (await findOpenWindow(args)) !== null
}

/**
 * Bulk lookup of open conversation windows for the given phones.
 *
 * NOTE: callers passing >500 phones should chunk. The PostgREST `.in()`
 * filter goes via GET query string and may exceed URL-length limits for
 * very large batches. WAQ-007's batch processor already chunks at
 * BATCH_SIZE=20, so the current consumer is safe.
 */
export async function bulkIsWindowOpen(
  args: BulkIsOpenArgs
): Promise<Set<string>> {
  if (args.phones.length === 0) return new Set()
  const supabase = createServerSupabaseClient()
  const at = (args.at ?? new Date()).toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .select('phone_e164')
    .eq('restaurant_id', args.restaurantId)
    .gt('expires_at', at)
    .in('phone_e164', args.phones)
  if (error) throw new Error(`bulkIsWindowOpen: ${error.message}`)
  const rows = (data ?? []) as Array<{ phone_e164: string }>
  return new Set(rows.map((r) => r.phone_e164))
}

// Compile-time contract lock: surfaces port-drift here, not at call sites.
export const conversationWindowRepository: ConversationWindowRepository = {
  findOpen: findOpenWindow,
  upsertOpen: upsertOpenWindow,
  isOpen: isWindowOpen,
  bulkIsOpen: bulkIsWindowOpen,
}
