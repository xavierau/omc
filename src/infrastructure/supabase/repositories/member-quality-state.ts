// WAQ-003: per-recipient quality-state writers. Driven by the dispatcher in
// `src/application/dispatch-error-action.ts` on Meta error codes 131049
// (PMM hit) and 131026 (recipient unreachable).
//
// READ-side gating against these columns is WAQ-007. This file is write-only.

import { createServerSupabaseClient } from '../client'

/**
 * Set `members.pmm_throttled_until` to `now() + cooldownHours`. Idempotent
 * with a regression guard: a longer existing cooldown is preserved
 * (`pmm_throttled_until IS NULL OR pmm_throttled_until < $newValue`) so a
 * second 131049 within the same window does not shorten the throttle.
 *
 * Scoped to `(memberId, restaurantId)` per design §6.2 — defence-in-depth
 * tenant isolation so accidental cross-tenant mutations are structurally
 * impossible even if a member id collides across restaurants.
 */
export async function throttleMemberPmm(
  memberId: string,
  restaurantId: string,
  cooldownHours: number
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const newUntil = new Date(
    Date.now() + cooldownHours * 3600_000
  ).toISOString()
  const { error } = await supabase
    .from('members')
    .update({ pmm_throttled_until: newUntil })
    .eq('id', memberId)
    .eq('restaurant_id', restaurantId)
    // PostgREST OR filter: keep the longer cooldown if one is already set.
    .or(
      `pmm_throttled_until.is.null,pmm_throttled_until.lt.${newUntil}`
    )
  if (error) throw new Error(`throttleMemberPmm: ${error.message}`)
}

/**
 * Set `members.unreachable_at = now()` for the given member. One-way flag for
 * this slice — ops clears via SQL until WAQ-009 ships the admin UI. Repeated
 * calls simply rewrite the timestamp (idempotent).
 *
 * Scoped to `(memberId, restaurantId)` per design §6.2 — defence-in-depth
 * tenant isolation.
 */
export async function markMemberUnreachable(
  memberId: string,
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('members')
    .update({ unreachable_at: new Date().toISOString() })
    .eq('id', memberId)
    .eq('restaurant_id', restaurantId)
  if (error) throw new Error(`markMemberUnreachable: ${error.message}`)
}

/**
 * MEM-004: clear `members.unreachable_at` for the member with this phone, in
 * ONE conditional UPDATE (no preceding read). Scoped by `restaurant_id` and
 * guarded by `unreachable_at IS NOT NULL`, so it is idempotent and only the
 * first of concurrent callers matches a row. Returns the cleared member id, or
 * null when the phone is unknown or the flag was already null. Pmm throttle and
 * consent are untouched.
 */
export async function clearMemberUnreachable(
  restaurantId: string,
  phoneE164: string
): Promise<{ memberId: string } | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .update({ unreachable_at: null })
    .eq('restaurant_id', restaurantId)
    .eq('phone', phoneE164)
    .not('unreachable_at', 'is', null)
    .select('id')
  if (error) throw new Error(`clearMemberUnreachable: ${error.message}`)
  if (!data || data.length === 0) return null
  return { memberId: data[0].id as string }
}
