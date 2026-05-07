import { upgradeGradeToStrong } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'

interface ConfirmInput {
  restaurantId: string
  phoneE164: string
}

/**
 * WONB-008: idempotent weak+opted_in → strong+opted_in transition for the
 * re-confirmation campaign YES handler. Returns upgraded=false (no throw)
 * when no weak+opted_in row matched — covers already-strong, weak+pending,
 * and missing-row. Mirrors `confirmMarketingOptin` (WONB-007), but the
 * source string + `previousGrade=weak` payload distinguish the funnel.
 */
export async function confirmReconfirmationConsent(
  input: ConfirmInput
): Promise<{ upgraded: boolean }> {
  const upgraded = await upgradeGradeToStrong({
    restaurantId: input.restaurantId,
    phoneE164: input.phoneE164,
    category: 'marketing',
  })
  if (!upgraded) return { upgraded: false }

  const member = await findMemberByPhone(input.restaurantId, input.phoneE164)
  await emitEvent({
    restaurantId: input.restaurantId,
    memberId: member?.id ?? null,
    type: 'consent_granted',
    dataJson: { source: 'reconfirmation_campaign', previousGrade: 'weak' },
  })
  return { upgraded: true }
}
