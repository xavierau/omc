import { Language } from '@/domain/value-objects/language'

/**
 * Fallback chain for the send-time language choice:
 *
 *   member.preferred_language
 *     → restaurant.default_language
 *       → Language.default()
 *
 * Invalid / unknown codes at any level fall through to the next. Keeps the
 * chain in one place so welcome, returning-member, and broadcast flows all
 * agree on precedence without duplicating `Language.fromCodeOrDefault`
 * ladders.
 */
export function resolvePreferredLanguage(
  member: { preferredLanguage: string | null } | null,
  restaurant: { defaultLanguage: string | null }
): Language {
  const restaurantLanguage = Language.fromCodeOrDefault(
    restaurant.defaultLanguage,
    Language.default()
  )
  return Language.fromCodeOrDefault(
    member?.preferredLanguage ?? null,
    restaurantLanguage
  )
}
