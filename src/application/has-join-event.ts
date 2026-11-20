import { hasJoinEvent } from '@/infrastructure/supabase/repositories/event-repository'

/**
 * WONB-020: an existing member with no `join` event (e.g. CSV-imported,
 * which writes only `consent_imported`) was never welcomed, so their first
 * JOIN claims the welcome offer. The claim's own join event makes every
 * later JOIN a welcome-back.
 *
 * Fails toward NOT claimable: a lookup error must never mint a coupon.
 */
export async function canClaimWelcome(
  restaurantId: string,
  memberId: string
): Promise<boolean> {
  try {
    return !(await hasJoinEvent(restaurantId, memberId))
  } catch (err) {
    console.warn('[onboarding] join-event lookup failed, treating as already welcomed:', err)
    return false
  }
}
