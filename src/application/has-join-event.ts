import { hasJoinEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { hasWelcomeCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'

/**
 * WONB-020: an existing member with no `join` event (e.g. CSV-imported,
 * which writes only `consent_imported`) was never welcomed, so their first
 * JOIN claims the welcome offer. The claim's own join event makes every
 * later JOIN a welcome-back.
 *
 * r1 F2 / r2 G3: a member who already holds a welcome coupon (type
 * `welcome`, or a coupon of any welcome-type campaign) is not claimable
 * either, so a mint whose join-event write failed is never minted again.
 *
 * Fails toward NOT claimable: a lookup error must never mint a coupon.
 */
export async function canClaimWelcome(
  restaurantId: string,
  memberId: string
): Promise<boolean> {
  try {
    if (await hasJoinEvent(restaurantId, memberId)) return false
    return !(await hasWelcomeCoupon(restaurantId, memberId))
  } catch (err) {
    console.warn('[onboarding] welcome claim lookup failed, treating as already welcomed:', err)
    return false
  }
}
