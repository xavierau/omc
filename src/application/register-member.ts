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
import { onboardNewMember, type OnboardContext } from './onboard-new-member'
import { sendReturningWelcome } from './send-returning-welcome'
import { createOrGetMember } from './create-or-get-member'
import { resolveLegacyMemberE164 } from './resolve-legacy-member-e164'
import { canClaimWelcome, isAlreadyWelcomed } from './has-join-event'
import {
  attemptWelcomeClaimLock,
  tryAcquireWelcomeClaimLock,
  waitForWelcomeClaimLock,
} from '@/infrastructure/redis/welcome-claim-lock'
import { findLatestWelcomeOfferCode } from '@/infrastructure/supabase/repositories/coupon-repository'

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
    return respondToExistingMember(restaurantId, phoneNumberId, phone, existing, contactName)
  }

  return createNewMember(restaurantId, phoneNumberId, phone, resolvedPhone, contactName, inboundText)
}

interface ExistingMember {
  id: string
  points_balance: number
  name: string | null
  preferred_language?: string | null
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

// WONB-020: never welcomed (no join event, e.g. imported) -> claim once.
// r6 J3: the pre-check and the createOrGetMember race both come through here.
async function respondToExistingMember(
  restaurantId: string,
  phoneNumberId: string,
  phone: PhoneNumber,
  existing: ExistingMember,
  contactName?: string
): Promise<RegisterResult> {
  if (await canClaimWelcome(restaurantId, existing.id)) {
    return claimWelcomeUnderLock(restaurantId, phoneNumberId, phone, existing, contactName)
  }
  return respondToReturningMember(restaurantId, phoneNumberId, phone, existing, contactName)
}

async function respondToReturningMember(
  restaurantId: string,
  phoneNumberId: string,
  phone: PhoneNumber,
  existing: ExistingMember,
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

// WONB-020 r1 F3: one claim at a time per (restaurant, member). No lock
// (held elsewhere, or Redis down) -> welcome-back, never a coupon; the
// claim is re-checked under the lock so a claim that just finished wins.
async function claimWelcomeUnderLock(
  restaurantId: string,
  phoneNumberId: string,
  phone: PhoneNumber,
  existing: ExistingMember,
  contactName?: string
): Promise<RegisterResult> {
  const lease = await tryAcquireWelcomeClaimLock(restaurantId, existing.id)
  if (!lease) return respondToReturningMember(restaurantId, phoneNumberId, phone, existing, contactName)
  try {
    if (!(await canClaimWelcome(restaurantId, existing.id))) {
      return respondToReturningMember(restaurantId, phoneNumberId, phone, existing, contactName)
    }
    return await claimWelcomeForExisting(restaurantId, phoneNumberId, phone, existing, contactName)
  } finally {
    await lease.release()
  }
}

// r2 G1 (supersedes r1 F4 after the mint): any failure inside the claim ->
// recoverFailedClaim, never a silent coupon.
async function claimWelcomeForExisting(
  restaurantId: string,
  phoneNumberId: string,
  phone: PhoneNumber,
  existing: ExistingMember,
  contactName?: string
): Promise<RegisterResult> {
  try {
    const couponCode = await onboardNewMember({
      restaurantId,
      phoneNumberId,
      phone: phone.value,
      memberId: existing.id,
      contactName: existing.name ?? contactName,
      memberPreferredLanguage: existing.preferred_language ?? null,
    })
    return { isNew: false, memberId: existing.id, pointsBalance: existing.points_balance, couponCode }
  } catch (err) {
    console.warn('[register] welcome claim failed:', (err as Error).message)
    return recoverFailedClaim(restaurantId, phoneNumberId, phone, existing, contactName)
  }
}

// r2 G1 (main ruling 2026-11-20): a failure after the mint (e.g. the join
// event write) leaves a coupon the member was never told about, and that
// coupon blocks any later claim. None was on file under the lock, so a
// welcome offer on file now is this claim's: send its code in the minimal
// welcome text. None on file, or the lookup/send fails -> welcome-back.
async function recoverFailedClaim(
  restaurantId: string,
  phoneNumberId: string,
  phone: PhoneNumber,
  existing: ExistingMember,
  contactName?: string
): Promise<RegisterResult> {
  try {
    const couponCode = await findLatestWelcomeOfferCode(restaurantId, existing.id)
    if (couponCode) {
      await sendClaimedCode(restaurantId, phoneNumberId, phone.value, existing.preferred_language ?? null, couponCode)
      return { isNew: false, memberId: existing.id, pointsBalance: existing.points_balance, couponCode }
    }
  } catch (err) {
    console.warn('[register] welcome claim recovery failed, sending welcome-back:', (err as Error).message)
  }
  return respondToReturningMember(restaurantId, phoneNumberId, phone, existing, contactName)
}

// Language resolved as onboardNewMember does; throws when the send fails.
async function sendClaimedCode(
  restaurantId: string,
  phoneNumberId: string,
  phone: string,
  memberPreferredLanguage: string | null,
  couponCode: string
): Promise<void> {
  const settings = await getOnboardingSettings(restaurantId).catch(() => null)
  const language = resolvePreferredLanguage(
    { preferredLanguage: memberPreferredLanguage },
    { defaultLanguage: settings?.defaultLanguage ?? null }
  )
  const sent = await sendTextMessage(phoneNumberId, phone, minimalWelcomeText(language, couponCode))
  if (!sent.ok) throw new Error(`welcome code send not ok: ${sent.error?.title ?? 'unknown'}`)
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
    return respondToExistingMember(
      restaurantId,
      phoneNumberId,
      phone,
      { id: existing.id, points_balance: existing.pointsBalance, name: existing.name, preferred_language: existing.preferredLanguage },
      contactName
    )
  }

  const member: OnboardContext = {
    restaurantId,
    phoneNumberId,
    phone: phone.value,
    memberId: result.memberId,
    contactName,
    memberPreferredLanguage,
  }
  // WONB-020 r4 H1: hold the claim lock through the mint, join event and
  // sends, so a second JOIN that already sees this row gets welcome-back.
  // Held -> a concurrent claim got here first (r6 J2: wait for it).
  // Redis down -> fail open: the lock only exists to block claims.
  const lock = await attemptWelcomeClaimLock(restaurantId, result.memberId)
  if (lock.kind === 'held') return welcomeAfterConcurrentClaim(member)
  if (lock.kind === 'unavailable') {
    console.warn('[register] welcome lock unavailable for a new member, onboarding without it:', result.memberId)
  }
  try {
    return await onboardCreatedMember(member)
  } finally {
    if (lock.kind === 'acquired') await lock.lease.release()
  }
}

// The caller holds the lock (or Redis is down). A failure after the insert
// -> the no-code minimal welcome.
async function onboardCreatedMember(member: OnboardContext): Promise<RegisterResult> {
  let couponCode: string | undefined
  try {
    couponCode = await onboardNewMember(member)
  } catch (err) {
    console.warn('[register] Post-insert step failed:', (err as Error).message)
    return sendMinimalWelcomeOnly(member)
  }
  return { isNew: true, memberId: member.memberId, pointsBalance: 0, couponCode }
}

// WONB-020 r6 J2: a concurrent JOIN claim holds this new member's lock. Wait
// for it (<= ~5 s), then re-check under the lock: welcomed by that claim ->
// nothing more to send; not welcomed -> onboard as usual. Still held, or the
// lookup fails -> the no-code minimal welcome; never a mint without the
// lock, and the member stays claimable (JOIN again).
async function welcomeAfterConcurrentClaim(member: OnboardContext): Promise<RegisterResult> {
  const lease = await waitForWelcomeClaimLock(member.restaurantId, member.memberId)
  if (!lease) {
    console.warn('[register] welcome lock still held after the wait, sending the minimal welcome:', member.memberId)
    return sendMinimalWelcomeOnly(member)
  }
  try {
    const welcomed = await isAlreadyWelcomed(member.restaurantId, member.memberId).catch((err: Error) => {
      console.warn('[register] welcomed lookup failed after the wait, sending the minimal welcome:', err.message)
      return null
    })
    if (welcomed === null) return await sendMinimalWelcomeOnly(member)
    if (welcomed) return { isNew: true, memberId: member.memberId, pointsBalance: 0 }
    return await onboardCreatedMember(member)
  } finally {
    await lease.release()
  }
}

async function sendMinimalWelcomeOnly(member: OnboardContext): Promise<RegisterResult> {
  await sendFallbackMinimalWelcome(member.restaurantId, member.phoneNumberId, member.phone, member.memberPreferredLanguage)
  return { isNew: true, memberId: member.memberId, pointsBalance: 0 }
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
