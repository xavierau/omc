// INVARIANT (WAQ-008): the SOLE writer to the `conversation_windows` table.
// `createServerSupabaseClient()` uses SUPABASE_SERVICE_ROLE_KEY which bypasses
// RLS — there are no INSERT/UPDATE policies on the table by design. Do NOT
// add a browser-side write path; route every mutation through the named
// functions below so callers stay observable. Mirrors the same posture as
// `whatsapp-message-repository.ts` and `quality-state-repository.ts`.

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
 * Find-then-bump-or-insert. Atomicity caveat: two concurrent inbounds
 * for the same (rid, phone) within the same millisecond could both miss
 * the existing-row lookup and INSERT — the unique index on
 * (restaurant_id, phone_e164, opened_at) prevents *exactly-equal* opened_at
 * collisions, but they would otherwise both succeed as separate rows.
 * In practice this race is benign: both rows expire 24h after their
 * respective inbound times, and the read query (`expires_at > now()`
 * ORDER BY expires_at DESC LIMIT 1) always returns the most-recent open
 * row. Cleanup task can dedupe history later if needed.
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
  if (error) throw new Error(`upsertOpenWindow: ${error.message}`)
  return fresh
}

export async function isWindowOpen(args: FindOpenArgs): Promise<boolean> {
  return (await findOpenWindow(args)) !== null
}

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

// Compile-time contract lock: this object MUST satisfy the domain repository
// interface. If a future edit drifts a function signature away from the port,
// TS surfaces it here rather than at the call sites or — worse — at runtime.
export const conversationWindowRepository: ConversationWindowRepository = {
  findOpen: findOpenWindow,
  upsertOpen: upsertOpenWindow,
  isOpen: isWindowOpen,
  bulkIsOpen: bulkIsWindowOpen,
}
