import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  createWelcomeCoupon,
  createCampaignCoupon,
} from '@/infrastructure/supabase/repositories/coupon-factory'
import { emitEvent } from '@/application/emit-event'
import {
  getCampaignById,
  incrementCampaignSent,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import type { E164Phone } from '@/domain/value-objects/e164-phone'
import type { Campaign } from '@/domain/entities/campaign'
import { createOrGetMember } from './create-or-get-member'
import { resolveLegacyMemberE164 } from './resolve-legacy-member-e164'

interface WebRegisterResult {
  isNew: boolean
  memberId: string
  couponCode?: string
}

// G-3 / N-8: the strict-then-fallback E.164 resolver itself now lives in
// resolve-legacy-member-e164.ts (shared with register-member.ts and, as of
// N-8, import-contacts-batch-row-member.ts). Re-exported under this
// module's own name so existing importers -- including
// resolve-legacy-member-e164.property.test.ts's
// `resolveLegacyMemberE164 as resolveWebLegacyE164` import -- are
// unaffected by the extraction.
export { resolveLegacyMemberE164 } from './resolve-legacy-member-e164'

export async function registerMemberWeb(
  rawPhone: string,
  contactName: string,
  restaurantId: string
): Promise<WebRegisterResult> {
  const phone = PhoneNumber.create(rawPhone)
  // N-9 (WI-17 confirmation review): resolved ONCE and used for the
  // pre-check below -- was `phone.value` (the un-repaired legacy format),
  // so a member first created via the fallback (stored normalised) missed
  // its own pre-check on a second join with the same raw dotted/legacy
  // input, fell into the seam, and only avoided a 500 because the seam's
  // OWN re-select (member-create-repository.ts, fed this SAME resolved
  // value) already found the row correctly.
  const resolvedPhone = resolveLegacyMemberE164(phone)
  const supabase = createServerSupabaseClient()

  const { data: existing } = await supabase
    .from('members')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('phone', resolvedPhone.value)
    .single()

  if (existing) {
    return { isNew: false, memberId: existing.id }
  }

  return createNewWebMember(resolvedPhone, contactName, restaurantId)
}

async function createNewWebMember(
  resolvedPhone: E164Phone,
  name: string,
  restaurantId: string
): Promise<WebRegisterResult> {
  // INT-001 T-H6: creation routes through the single member-creation seam
  // (member.created fans out to enabled integrations with source:'web'). A
  // 23505 on (restaurant_id, phone) now resolves to outcome:'existing'
  // rather than an insert failure -- the pre-check above already covers the
  // common case, so this only bites on a genuine race between two
  // near-simultaneous submissions for the same number, which previously
  // threw and now degrades gracefully to the same isNew:false result.
  const result = await createOrGetMember({
    restaurantId,
    phoneE164: resolvedPhone,
    name,
    preferredLanguage: null,
    source: 'web',
  })

  if (result.outcome === 'existing') {
    return { isNew: false, memberId: result.memberId }
  }

  const campaign = await resolveWelcomeCampaign(restaurantId)
  const coupon = campaign
    ? await mintCampaignCoupon(restaurantId, result.memberId, campaign, name)
    : await createWelcomeCoupon(restaurantId, result.memberId)

  await emitEvent({
    restaurantId,
    memberId: result.memberId,
    type: 'join',
    dataJson: {
      source: 'web',
      coupon_code: coupon.code,
      campaign_id: campaign?.id ?? null,
    },
  })

  return { isNew: true, memberId: result.memberId, couponCode: coupon.code }
}

async function resolveWelcomeCampaign(
  restaurantId: string
): Promise<Campaign | null> {
  const settings = await getOnboardingSettings(restaurantId).catch((err) => {
    console.warn('[onboarding/web] welcome settings load failed:', err)
    return null
  })
  if (!settings?.welcomeCampaignId) return null
  return getCampaignById(settings.welcomeCampaignId).catch((err) => {
    console.warn('[onboarding/web] welcome campaign lookup failed:', err)
    return null
  })
}

async function mintCampaignCoupon(
  restaurantId: string,
  memberId: string,
  campaign: Campaign,
  name: string
): Promise<{ code: string; id: string }> {
  try {
    const coupon = await createCampaignCoupon(restaurantId, memberId, campaign, name)
    await incrementCampaignSent(campaign.id, campaign.isChargeable).catch((err) => {
      console.warn('[onboarding] welcome campaign counter increment failed:', err)
    })
    return coupon
  } catch {
    // Campaign mapping exists but is broken (no coupon_config). Fall back.
    return createWelcomeCoupon(restaurantId, memberId)
  }
}
