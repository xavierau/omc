// CLAIM-THEN-PROCESS INVARIANT (WAQ-002):
//   `tryMarkProcessed` is the atomic claim. It MUST run BEFORE any webhook
//   side effect (DB write, member mutation, ops alert) so that two concurrent
//   Kapso retries cannot both pass the duplicate check and double-fire.
//   `releaseIdempotencyKey` exists ONLY to undo a claim when we discovered
//   we cannot fulfil it (e.g. the outbound row hasn't been UPDATEd with the
//   kapso_message_id yet — see find-message-by-kapso-id.ts). It must NEVER
//   be called after a successful side effect lands.

import { createServerSupabaseClient } from './client'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

const PROCESSED_TABLE = 'processed_webhooks'
const PG_UNIQUE_VIOLATION = '23505'

export type IdempotencyClaim = 'new' | 'duplicate' | 'error'

/**
 * Attempts to atomically claim an idempotency key by inserting a row into
 * `processed_webhooks`. The unique constraint on `idempotency_key` makes
 * concurrent inserts race-safe — exactly one gets `'new'`, the rest get
 * `'duplicate'`.
 */
export async function tryMarkProcessed(
  idempotencyKey: string,
  log: LogFn
): Promise<IdempotencyClaim> {
  const supabase = createServerSupabaseClient()

  const { error } = await supabase
    .from(PROCESSED_TABLE)
    .insert({ idempotency_key: idempotencyKey })

  if (!error) {
    log('info', 'webhook.idempotency', { status: 'new', idempotencyKey })
    return 'new'
  }

  if (error.code === PG_UNIQUE_VIOLATION) {
    log('info', 'webhook.idempotency', {
      status: 'duplicate',
      idempotencyKey,
    })
    return 'duplicate'
  }

  log('error', 'webhook.idempotency', {
    status: 'error',
    idempotencyKey,
    error: error.message,
  })
  return 'error'
}

/**
 * Undoes a successful `tryMarkProcessed` claim. Use ONLY when the handler
 * cannot fulfil the work yet (e.g. orphan webhook arriving before the
 * outbound row exists) so a future retry can re-claim and succeed.
 */
export async function releaseIdempotencyKey(
  idempotencyKey: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from(PROCESSED_TABLE)
    .delete()
    .eq('idempotency_key', idempotencyKey)
  if (error) {
    throw new Error(`releaseIdempotencyKey: ${error.message}`)
  }
}
