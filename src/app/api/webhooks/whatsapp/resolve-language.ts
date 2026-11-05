import { Language } from '@/domain/value-objects/language'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'

/**
 * Resolve the reply language for an inbound WhatsApp message using the shared
 * domain fallback chain:
 *
 *   member.preferred_language
 *     → restaurant.default_language
 *       → Language.default()
 *
 * Extracted into the webhook-adapter layer so every handler reads from one
 * canonical location — eliminates the copies that lived in
 * `unknown-help-handlers.ts` and `receipt-confirmation.ts`.
 */
export async function resolveLanguageForMember(
  member: { preferredLanguage: string | null } | null,
  restaurantId: string
): Promise<Language> {
  const defaultLanguage = await getRestaurantDefaultLanguage(restaurantId)
  return resolvePreferredLanguage(member, { defaultLanguage })
}
