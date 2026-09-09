import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { E164Phone } from '@/domain/value-objects/e164-phone'
import { detectLanguageFromText } from '@/domain/services/detect-language'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { minimalWelcomeText } from './onboarding-defaults'
import { onboardNewMember } from './onboard-new-member'
import { sendReturningWelcome } from './send-returning-welcome'
import { createOrGetMember } from './create-or-get-member'

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
    return respondToReturningMember(restaurantId, phoneNumberId, phone, existing, contactName)
  }

  return createNewMember(restaurantId, phoneNumberId, phone, contactName, inboundText)
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

async function respondToReturningMember(
  restaurantId: string,
  phoneNumberId: string,
  phone: PhoneNumber,
  existing: { id: string; points_balance: number; name: string | null; preferred_language?: string | null },
  contactName?: string
): Promise<RegisterResult> {
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

async function createNewMember(
  restaurantId: string,
  phoneNumberId: string,
  phone: PhoneNumber,
  contactName?: string,
  inboundText?: string
): Promise<RegisterResult> {
  const detectedLang = detectLanguageFromText(inboundText)
  const memberPreferredLanguage = detectedLang?.code ?? null

  // INT-001 T-H6: creation routes through the single member-creation seam
  // (member.created fans out to enabled integrations with source:'whatsapp').
  // A 23505 unique-violation on (restaurant_id, phone) now resolves to
  // outcome:'existing' rather than an insert failure everywhere the seam is
  // used -- the pre-check above already covers the common case, so this
  // branch is only reached on a genuine race (two near-simultaneous JOINs
  // for the same number). Previously that race threw; now it degrades
  // gracefully into the same returning-member flow as the pre-check branch.
  const result = await createOrGetMember({
    restaurantId,
    phoneE164: E164Phone.of(phone.value),
    name: contactName ?? null,
    preferredLanguage: memberPreferredLanguage,
    source: 'whatsapp',
  })

  if (result.outcome === 'existing') {
    const existing = await findMemberByPhone(restaurantId, phone.value)
    if (!existing) {
      // The row that caused the conflict is gone by the time we re-select --
      // surface as an error rather than silently fabricating a result.
      throw new Error('registerMember: race on create but no row found on re-select')
    }
    return respondToReturningMember(
      restaurantId,
      phoneNumberId,
      phone,
      { id: existing.id, points_balance: existing.pointsBalance, name: existing.name, preferred_language: existing.preferredLanguage },
      contactName
    )
  }

  let couponCode: string | undefined
  try {
    couponCode = await onboardNewMember({
      restaurantId,
      memberId: result.memberId,
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

  return { isNew: true, memberId: result.memberId, pointsBalance: 0, couponCode }
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
