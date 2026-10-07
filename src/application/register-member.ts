import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import type { E164Phone } from '@/domain/value-objects/e164-phone'
import { detectLanguageFromText } from '@/domain/services/detect-language'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { minimalWelcomeText } from './onboarding-defaults'
import { onboardNewMember } from './onboard-new-member'
import { sendReturningWelcome } from './send-returning-welcome'
import { createOrGetMember } from './create-or-get-member'
import { resolveLegacyMemberE164 } from './resolve-legacy-member-e164'

interface RegisterResult {
  isNew: boolean
  memberId: string
  pointsBalance: number
  couponCode?: string
}

// G-3 / N-8: the strict-then-fallback E.164 resolver itself now lives in
// resolve-legacy-member-e164.ts (shared with register-member-web.ts and,
// as of N-8, import-contacts-batch-row-member.ts). Re-exported under this
// module's own name so existing importers -- including
// resolve-legacy-member-e164.property.test.ts's
// `resolveLegacyMemberE164 as resolveWhatsappLegacyE164` import -- are
// unaffected by the extraction.
export { resolveLegacyMemberE164 } from './resolve-legacy-member-e164'

export async function registerMember(
  restaurantId: string,
  rawPhone: string,
  contactName?: string,
  inboundText?: string
): Promise<RegisterResult> {
  const phone = PhoneNumber.create(rawPhone)
  // N-9 (WI-17 confirmation review): resolved ONCE here and threaded through
  // every DB lookup below (pre-check, seam, race re-select) -- previously
  // each of those re-derived (or skipped deriving) the E.164 independently,
  // so a legacy-accepted format (e.g. a dotted phone) that got NORMALISED
  // on first insert would miss its own pre-check AND its own race re-select
  // on a second join, throwing "race on create but no row found" -> 500,
  // even though the member genuinely already existed.
  const resolvedPhone = resolveLegacyMemberE164(phone)
  const supabase = createServerSupabaseClient()
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)

  const existing = await findExistingMember(supabase, restaurantId, resolvedPhone.value)
  if (existing) {
    return respondToReturningMember(restaurantId, phoneNumberId, phone, existing, contactName)
  }

  return createNewMember(restaurantId, phoneNumberId, phone, resolvedPhone, contactName, inboundText)
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
  resolvedPhone: E164Phone,
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
    phoneE164: resolvedPhone,
    name: contactName ?? null,
    preferredLanguage: memberPreferredLanguage,
    source: 'whatsapp',
  })

  if (result.outcome === 'existing') {
    // N-9: was `phone.value` (the un-repaired legacy format) -- the seam's
    // OWN re-select above already resolved this conflict correctly (it was
    // given `resolvedPhone`), but this SEPARATE lookup (needed only to fetch
    // the full profile -- points/name/language -- the seam's result doesn't
    // carry) missed the row whenever the stored phone was normalised from a
    // legacy format, throwing the "race... no row found" error below on
    // every second join with the same raw dotted/legacy input.
    const existing = await findMemberByPhone(restaurantId, resolvedPhone.value)
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
