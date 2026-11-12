/**
 * Language resolver for the receipt-processing flow.
 *
 * Unlike the webhook-adapter `resolveLanguageForMember` helper (which works
 * from an already-loaded member row), this runs from a bare `memberId` and
 * issues its own lookup. Used by `process-receipt.ts` for the confirmation
 * prompt, rejection reasons, and points-awarded notification.
 */
import { Language } from '@/domain/value-objects/language'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { getMemberPreferredLanguage } from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'

export async function resolveLanguageForReceipt(
  memberId: string,
  restaurantId: string
): Promise<Language> {
  const [preferredLanguage, defaultLanguage] = await Promise.all([
    getMemberPreferredLanguage(memberId, restaurantId),
    getRestaurantDefaultLanguage(restaurantId),
  ])
  return resolvePreferredLanguage({ preferredLanguage }, { defaultLanguage })
}
