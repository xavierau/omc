import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { createCoupon, createWelcomeCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { getCampaignById } from '@/infrastructure/supabase/repositories/campaign-repository'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/value-objects/template-vars'

interface WebRegisterResult {
  isNew: boolean
  memberId: string
  couponCode?: string
}

export async function registerMemberWeb(
  rawPhone: string,
  contactName: string,
  restaurantId: string,
  campaignId?: string
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

  return createNewWebMember(supabase, phone, contactName, restaurantId, campaignId)
}

async function createNewWebMember(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  phone: PhoneNumber,
  name: string,
  restaurantId: string,
  campaignId?: string
): Promise<WebRegisterResult> {
  const { data: newMember, error } = await supabase
    .from('members')
    .insert({
      restaurant_id: restaurantId,
      phone: phone.value,
      status: 'active',
      name,
    })
    .select('id')
    .single()

  if (error || !newMember) {
    throw new Error(`registerMemberWeb: ${error?.message}`)
  }

  let coupon: { code: string; id: string }
  if (campaignId) {
    try {
      coupon = await createCampaignCoupon(restaurantId, newMember.id, campaignId, name)
    } catch {
      // Campaign missing or has no coupon config — fall back to welcome coupon
      coupon = await createWelcomeCoupon(restaurantId, newMember.id)
    }
  } else {
    coupon = await createWelcomeCoupon(restaurantId, newMember.id)
  }

  await createEvent({
    restaurantId,
    memberId: newMember.id,
    type: 'join',
    dataJson: { source: 'web', coupon_code: coupon.code, campaign_id: campaignId ?? null },
  })

  return { isNew: true, memberId: newMember.id, couponCode: coupon.code }
}

async function createCampaignCoupon(
  restaurantId: string,
  memberId: string,
  campaignId: string,
  memberName: string
): Promise<{ code: string; id: string }> {
  const campaign = await getCampaignById(campaignId)
  if (!campaign?.couponConfig) {
    throw new Error('Campaign not found or has no coupon config')
  }

  const expiresAt = new Date(
    Date.now() + campaign.couponConfig.expiresInDays * 24 * 60 * 60 * 1000
  ).toISOString()

  const code = generateCouponCode()
  const discount = formatDiscount(campaign.couponConfig)
  const description = renderTemplate(campaign.template, {
    name: memberName,
    code,
    discount,
  })
  const coupon = await createCoupon({
    restaurantId,
    type: 'promo',
    code,
    memberId,
    expiresAt,
    maxUses: 1,
    discountType: campaign.couponConfig.discountType,
    discountValue: campaign.couponConfig.discountValue,
    campaignId,
    title: campaign.name ?? null,
    description,
  })

  return { code: coupon.code, id: coupon.id }
}

function formatDiscount(config: { discountType: string; discountValue: number }): string {
  if (config.discountType === 'percentage') return `${config.discountValue}%`
  return `HK$${config.discountValue}`
}
