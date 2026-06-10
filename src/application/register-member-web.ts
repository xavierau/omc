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
import { loyaltyToken } from '@/domain/value-objects/loyalty-token'
import type { Campaign } from '@/domain/entities/campaign'

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

  return createNewWebMember(supabase, phone, contactName, restaurantId)
}

async function createNewWebMember(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  phone: PhoneNumber,
  name: string,
  restaurantId: string
): Promise<WebRegisterResult> {
  const { data: newMember, error } = await supabase
    .from('members')
    .insert({
      restaurant_id: restaurantId,
      phone: phone.value,
      status: 'active',
      name,
      loyalty_token: loyaltyToken(),
    })
    .select('id')
    .single()

  if (error || !newMember) {
    throw new Error(`registerMemberWeb: ${error?.message}`)
  }

  const campaign = await resolveWelcomeCampaign(restaurantId)
  const coupon = campaign
    ? await mintCampaignCoupon(restaurantId, newMember.id, campaign, name)
    : await createWelcomeCoupon(restaurantId, newMember.id)

  await emitEvent({
    restaurantId,
    memberId: newMember.id,
    type: 'join',
    dataJson: {
      source: 'web',
      coupon_code: coupon.code,
      campaign_id: campaign?.id ?? null,
    },
  })

  return { isNew: true, memberId: newMember.id, couponCode: coupon.code }
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
