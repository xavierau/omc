// WONB-008 P0 fix (review finding 1): race-free per-tenant daily-cap claim.
// Wraps the SECURITY DEFINER RPC `claim_reconfirmation_allotment` (migration
// 051). The RPC takes a per-tenant-per-day Postgres advisory lock so two
// concurrent campaign launches cannot both clear the eligibility check at
// the same `currentDailySent` and double the actual send volume.
//
// Returns the number of sends the caller may proceed with (0..requested).
// Returns 0 when another concurrent launch already holds the lock — the
// caller treats that as "skip cleanly, retry later".

import { createServerSupabaseClient } from '../client'

export async function claimReconfirmationAllotment(
  restaurantId: string,
  requested: number
): Promise<number> {
  if (requested <= 0) return 0
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('claim_reconfirmation_allotment', {
    p_restaurant_id: restaurantId,
    p_requested: requested,
    p_today: todayDateOnly(),
  })
  if (error) throw new Error(`claimReconfirmationAllotment: ${error.message}`)
  return typeof data === 'number' ? data : 0
}

// Server-local YYYY-MM-DD. Matches the `todayStart()` window in
// `reconfirmation-queries.ts` (intentionally consistent so the JS and SQL
// sides share the same notion of "today"). Per-tenant-TZ rollover is the
// deferred follow-up tracked in `docs/tasks/wonb-008-followups.md`.
function todayDateOnly(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
