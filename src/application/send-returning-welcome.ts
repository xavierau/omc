import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { renderTemplate } from '@/domain/services/template-renderer'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { resolveReturningMemberTemplate } from './resolve-campaign-template'
import {
  buildReturningGreeting,
  defaultReturningText,
} from './onboarding-defaults'

export interface ReturningWelcomeInput {
  restaurantId: string
  phoneNumberId: string
  phone: string
  points: number
  memberPreferredLanguage: string | null
  name?: string
}

/**
 * Send the "Welcome back" message to a returning member. Picks language from
 * the member's stored `preferred_language` with the restaurant default as
 * fallback, then renders the custom template (if configured) or the
 * hardcoded bilingual default.
 */
export async function sendReturningWelcome(
  input: ReturningWelcomeInput
): Promise<void> {
  const settings = await getOnboardingSettings(input.restaurantId).catch(
    (err) => {
      console.warn('[onboarding] returning-member settings load failed:', err)
      return null
    }
  )
  const language = resolvePreferredLanguage(
    { preferredLanguage: input.memberPreferredLanguage },
    { defaultLanguage: settings?.defaultLanguage ?? null }
  )
  const greeting = buildReturningGreeting(language, input.name)
  const tpl = settings ? resolveReturningMemberTemplate(settings, language) : null
  const text = tpl
    ? renderTemplate(tpl, {
        greeting,
        points: input.points,
        name: input.name ?? '',
      })
    : defaultReturningText(language, greeting, input.points)
  await sendTextMessage(input.phoneNumberId, input.phone, text)
}
