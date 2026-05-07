import {
  findReconfirmationAudience,
  type ReconfirmationAudienceRow,
} from '@/infrastructure/supabase/repositories/consent-record-repository'

interface ResolveInput {
  restaurantId: string
  // From the eligibility check: cap - currentDailySent. Hard zero/negative
  // short-circuits without a DB round-trip.
  remainingCap: number
}

export type ReconfirmationAudienceMember = ReconfirmationAudienceRow

/**
 * WONB-008 audience resolver. Thin orchestration around the repo query —
 * the SELECT enforces grade='weak' AND status='opted_in' AND
 * category='marketing' (verified at infrastructure layer); we just clamp
 * the limit. Sort order is captured_at DESC (most-recent legacy contacts
 * first, mirrors Stream A's product call: prioritise freshly imported
 * weak rows over years-old backfill rows when bidding for the daily cap).
 */
export async function resolveReconfirmationAudience(
  input: ResolveInput
): Promise<ReconfirmationAudienceMember[]> {
  if (input.remainingCap <= 0) return []
  return findReconfirmationAudience({
    restaurantId: input.restaurantId,
    limit: input.remainingCap,
  })
}
