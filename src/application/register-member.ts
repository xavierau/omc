import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { E164Phone } from '@/domain/value-objects/e164-phone'
import { parseE164Phone } from '@/infrastructure/phone/e164-parser'
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

/**
 * G-3 (WI-14, grok review): WI-7's seam refactor wraps the legacy
 * `PhoneNumber.create` output in `E164Phone.of` -- a STRICT format
 * assertion (`^\+[1-9]\d{7,14}$`). `PhoneNumber.create` only strips
 * `[\s\-()]`; it keeps dots and other characters, which a pre-seam insert
 * never validated this strictly. A WhatsApp number in a format the legacy
 * VO accepted (e.g. containing a dot) now throws uncaught here, 500-ing
 * the whole join with no member created.
 *
 * Fix: try the strict path first (preserves 100% of today's behaviour and
 * DB-lookup compatibility for the overwhelmingly common clean-input case);
 * only on failure, fall back to `parseE164Phone` -- the SAME
 * libphonenumber-backed parser the partner API path (T-C2) already uses --
 * to repair the legacy-accepted format into a valid E.164 instead of
 * crashing.
 *
 * If that ALSO fails (a fast-check property suite over `PhoneNumber`'s own
 * accepted grammar -- 8-15 digits, any other characters tolerated --
 * found this: a legacy-accepted value containing a letter, or one with a
 * leading-zero digit run, fails BOTH `E164Phone.of` -- for a bare-digit
 * value, `parseE164Phone`'s `[A-Za-z]`-rejecting pre-filter, or
 * libphonenumber itself), the number is genuinely unresolvable. Re-thrown
 * in `PhoneNumber.create`'s OWN error shape (`Invalid phone number: ...`)
 * -- not `E164Phone`'s internal assertion message -- so every caller's
 * EXISTING error handling still recognises it: the web join route's
 * `message.includes('Invalid phone')` -> 400 mapping, and the WhatsApp
 * handler's catch-all (which degrades gracefully regardless of message
 * text, but a recognisable shape is still the honest one to surface).
 * Exported for the property-test suite (register-member.property.test.ts).
 */
export function resolveLegacyMemberE164(phone: PhoneNumber): E164Phone {
  try {
    return E164Phone.of(phone.value)
  } catch {
    const parsed = parseE164Phone(phone.value)
    if (parsed instanceof E164Phone) return parsed
    throw new Error(`Invalid phone number: ${phone.value}`)
  }
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
    phoneE164: resolveLegacyMemberE164(phone),
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
