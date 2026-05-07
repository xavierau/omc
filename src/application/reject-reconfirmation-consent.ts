// WONB-008: NO-reply path for the re-confirmation campaign.
// Mirrors `reject-marketing-optin.ts` (WONB-007) but matches a DIFFERENT row
// shape — the reconfirmation audience is `consent_grade='weak' AND
// status='opted_in'`, not pending. The WONB-007 rejection use case targets
// pending rows only and so silently no-ops on the reconfirmation funnel
// (review finding for AC #6: NO must revoke).

import { findActiveConsent, revokeConsent } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'

interface RejectInput {
  restaurantId: string
  phoneE164: string
}

/**
 * Returns revoked=true ONLY when a weak+opted_in marketing row was flipped
 * to opted_out. Already-strong, already-opted_out, pending, or no-row all
 * return false — the caller falls through to the WONB-007 rejection (which
 * targets pending rows) so a user with both a pending opt-in AND a weak
 * audience row never accidentally double-acts.
 */
export async function rejectReconfirmationConsent(
  input: RejectInput
): Promise<{ revoked: boolean }> {
  const active = await findActiveConsent({
    restaurantId: input.restaurantId,
    phoneE164: input.phoneE164,
    category: 'marketing',
  })
  if (!active) return { revoked: false }
  const { consentGrade, status } = active.snapshot
  if (consentGrade !== 'weak' || status !== 'opted_in') {
    return { revoked: false }
  }

  const count = await revokeConsent({
    restaurantId: input.restaurantId,
    phoneE164: input.phoneE164,
    category: 'marketing',
  })
  if (count === 0) return { revoked: false }

  const member = await findMemberByPhone(input.restaurantId, input.phoneE164)
  await emitEvent({
    restaurantId: input.restaurantId,
    memberId: member?.id ?? null,
    type: 'consent_revoked',
    dataJson: { source: 'reconfirmation_campaign', previousGrade: 'weak' },
  })
  return { revoked: true }
}
