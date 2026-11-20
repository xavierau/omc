// "X to go" nudge reads/writes (plan §7 / §12). Kept off the hot-path member &
// stamp-card repositories: the nudge needs the member's contact + quality flags
// (036) AND an atomic once-per-card claim on member_stamp_cards.nudge_sent_at.
import { createServerSupabaseClient } from '../client'

export interface MemberNudgeState {
  phone: string
  preferredLanguage: string | null
  pmmThrottledUntil: string | null
  unreachableAt: string | null
}

/** Tenant-scoped: contact + marketing quality flags for the nudge gate, or null. */
export async function getMemberNudgeState(
  memberId: string,
  restaurantId: string
): Promise<MemberNudgeState | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('members')
    .select('phone, preferred_language, pmm_throttled_until, unreachable_at')
    .eq('id', memberId)
    .eq('restaurant_id', restaurantId)
    .single()

  if (!data) return null
  return {
    phone: data.phone as string,
    preferredLanguage: (data.preferred_language as string | null) ?? null,
    pmmThrottledUntil: (data.pmm_throttled_until as string | null) ?? null,
    unreachableAt: (data.unreachable_at as string | null) ?? null,
  }
}

/**
 * Atomically claim the once-per-card nudge slot: set nudge_sent_at = now() only
 * when it is still NULL. Returns true when THIS call won the claim (a row was
 * updated), false when the slot was already taken — so a concurrent double-grant
 * sends exactly one nudge. Mirrors setMemberPreferredLanguageIfUnset's TOCTOU
 * guard (write-then-detect via the returned rows).
 */
export async function claimNudgeSlot(cardId: string): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('member_stamp_cards')
    .update({ nudge_sent_at: new Date().toISOString() })
    .eq('id', cardId)
    .is('nudge_sent_at', null)
    .select('id')

  if (error) throw new Error(`claimNudgeSlot: ${error.message}`)
  return (data ?? []).length > 0
}
