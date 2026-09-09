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
import { E164Phone } from '@/domain/value-objects/e164-phone'
import type { Campaign } from '@/domain/entities/campaign'
import { createOrGetMember } from './create-or-get-member'

interface WebRegisterResult {
  isNew: boolean
  memberId: string
  couponCode?: string
}

export async function registerMemberWeb(
  rawPhone: string,
  contactName: string,
  restaurantId: string
): Promise<WebRegisterResult> {
  const phone = PhoneNumber.create(rawPhone)
  const supabase = createServerSupabaseClient()

  const { data: existing } = await supabase
    .from('members')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('phone', phone.value)
    .single()

  if (existing) {
    return { isNew: false, memberId: existing.id }
  }

  return createNewWebMember(phone, contactName, restaurantId)
}

async function createNewWebMember(
  phone: PhoneNumber,
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
    phoneE164: E164Phone.of(phone.value),
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
