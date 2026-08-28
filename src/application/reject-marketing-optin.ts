import { findRecentPendingMarketingConsent } from '@/infrastructure/supabase/repositories/optin-template-repository'
import { revokeConsent } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'

interface RejectInput {
  restaurantId: string
  phoneE164: string
}

/**
 * WONB-007: NO reply path. Revokes the pending opt-in row (if any) and
 * emits `consent_revoked`. Returns revoked=false when there is no pending
 * row OR when the revoke racy-loses to a concurrent confirm — in which
 * case the caller should fall through to `handleUnknown`.
 */
export async function rejectMarketingOptin(
  input: RejectInput
): Promise<{ revoked: boolean }> {
  const pending = await findRecentPendingMarketingConsent({
    restaurantId: input.restaurantId,
    phoneE164: input.phoneE164,
  })
  if (!pending) return { revoked: false }

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
    dataJson: { source: 'inbound_first_optin_rejected' },
  })
  return { revoked: true }
}
