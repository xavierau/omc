import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

const ORPHAN_AGE_MIN = 5

/**
 * Sweep `queued` rows older than 5 minutes to `failed/internal_orphan`.
 *
 * Why: the two-phase send pattern (insert queued -> BSP call -> update sent)
 * leaves rows stuck at `queued` if the worker crashes between phases. Meta
 * may have actually sent the message — we just lost track of the wamid.
 *
 * `error_code='internal_orphan'` means "we lost track", NOT "Meta refused".
 * Reports must bucket orphan rows separately from real failures, and the
 * dispatcher in WAQ-003 must NOT mutate `members` on `internal_orphan`
 * (classifyErrorCode maps it to `log_only`).
 */
export async function reconcileOrphanMessages(): Promise<{ swept: number }> {
  const supabase = createServerSupabaseClient()
  const cutoff = new Date(
    Date.now() - ORPHAN_AGE_MIN * 60_000
  ).toISOString()
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      error_code: 'internal_orphan',
      error_title: 'Orphaned queued row — process likely crashed mid-send',
    })
    .eq('status', 'queued')
    .is('kapso_message_id', null)
    .lt('queued_at', cutoff)
    .select('id')
  if (error) throw new Error(`reconcileOrphanMessages: ${error.message}`)
  return { swept: data?.length ?? 0 }
}
