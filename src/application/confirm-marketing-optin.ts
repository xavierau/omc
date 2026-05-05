import { upgradeToOptedIn } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'

interface ConfirmInput {
  restaurantId: string
  phoneE164: string
}

/**
 * WONB-007: idempotent pending → opted_in transition for the inbound-first
 * confirmation. Reusable by WONB-008 (re-confirmation campaign) — same
 * `upgradeToOptedIn` flip, only the event source string differs.
 */
export async function confirmMarketingOptin(
  input: ConfirmInput
): Promise<{ upgraded: boolean }> {
  const upgraded = await upgradeToOptedIn({
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
    dataJson: { source: 'inbound_first_optin' },
  })
  return { upgraded: true }
}
