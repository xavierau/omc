import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { loyaltyToken } from '@/domain/value-objects/loyalty-token'
import { detectLanguageFromText } from '@/domain/services/detect-language'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { minimalWelcomeText } from './onboarding-defaults'
import { onboardNewMember } from './onboard-new-member'
import { sendReturningWelcome } from './send-returning-welcome'

interface RegisterResult {
  isNew: boolean
  memberId: string
  pointsBalance: number
  couponCode?: string
}

export async function registerMember(
  restaurantId: string,
  rawPhone: string,
  contactName?: string,
  inboundText?: string
): Promise<RegisterResult> {
  const phone = PhoneNumber.create(rawPhone)
  const supabase = createServerSupabaseClient()
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)

  const existing = await findExistingMember(supabase, restaurantId, phone.value)
  if (existing) {
    const name = existing.name ?? contactName
    await sendReturningWelcome({
      restaurantId,
      phoneNumberId,
      phone: phone.value,
      points: existing.points_balance,
      memberPreferredLanguage: existing.preferred_language ?? null,
      name,
    })
    return { isNew: false, memberId: existing.id, pointsBalance: existing.points_balance }
  }

  return createNewMember(
    supabase,
    restaurantId,
    phoneNumberId,
    phone,
    contactName,
    inboundText
  )
}

async function findExistingMember(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string,
  phone: string
) {
  const { data } = await supabase
    .from('members')
    .select('id, points_balance, name, preferred_language')
    .eq('restaurant_id', restaurantId)
    .eq('phone', phone)
    .single()

  return data
}

async function createNewMember(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string,
  phoneNumberId: string,
  phone: PhoneNumber,
  contactName?: string,
  inboundText?: string
): Promise<RegisterResult> {
  const detectedLang = detectLanguageFromText(inboundText)
  const memberPreferredLanguage = detectedLang?.code ?? null
  const { data: newMember, error } = await supabase
    .from('members')
    .insert({
      restaurant_id: restaurantId,
      phone: phone.value,
      status: 'active',
      name: contactName ?? null,
      preferred_language: memberPreferredLanguage,
      loyalty_token: loyaltyToken(),
    })
    .select('id')
    .single()

  if (error || !newMember) throw new Error(`registerMember: ${error?.message}`)

  let couponCode: string | undefined
  try {
    couponCode = await onboardNewMember({
      restaurantId,
      memberId: newMember.id,
      phoneNumberId,
      phone: phone.value,
      contactName,
      memberPreferredLanguage,
    })
  } catch (err) {
    console.warn('[register] Post-insert step failed:', (err as Error).message)
    await sendFallbackMinimalWelcome(
      restaurantId,
      phoneNumberId,
      phone.value,
      memberPreferredLanguage
    )
  }

  return { isNew: true, memberId: newMember.id, pointsBalance: 0, couponCode }
}

async function sendFallbackMinimalWelcome(
  restaurantId: string,
  phoneNumberId: string,
  phone: string,
  memberPreferredLanguage: string | null
): Promise<void> {
  const settings = await getOnboardingSettings(restaurantId).catch(() => null)
  const language = resolvePreferredLanguage(
    { preferredLanguage: memberPreferredLanguage },
    { defaultLanguage: settings?.defaultLanguage ?? null }
  )
  await sendTextMessage(
    phoneNumberId,
    phone,
    minimalWelcomeText(language, '')
  ).catch((sendErr) => {
    console.warn('[onboarding] welcome message fallback send failed:', sendErr)
  })
}
