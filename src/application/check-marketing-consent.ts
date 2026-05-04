import { findActiveConsent } from '@/infrastructure/supabase/repositories/consent-record-repository'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'

export type ConsentRejectionReason = 'no_consent' | 'opted_out' | 'pending'

export interface ConsentCheckResult {
  allowed: boolean
  reason?: ConsentRejectionReason
  grade?: ConsentGrade
}

interface CheckArgs {
  restaurantId: string
  phoneE164: string
}

/**
 * Pre-send marketing-consent gate. Returns `{ allowed: true, grade }` only
 * when an opted_in record exists for (restaurantId, phoneE164, marketing).
 * Pending and (defensively) opted_out are denied so a stray pending row
 * cannot leak into a marketing send.
 */
export async function checkMarketingConsent(
  args: CheckArgs
): Promise<ConsentCheckResult> {
  const record = await findActiveConsent({
    restaurantId: args.restaurantId,
    phoneE164: args.phoneE164,
    category: 'marketing',
  })
  if (!record) return { allowed: false, reason: 'no_consent' }
  const { status, consentGrade } = record.snapshot
  if (status === 'opted_in') return { allowed: true, grade: consentGrade }
  if (status === 'pending') return { allowed: false, reason: 'pending' }
  return { allowed: false, reason: 'opted_out' }
}
