import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/services/template-renderer'
import { Campaign } from '@/domain/entities/campaign'
import { createCoupon } from './coupon-repository'

const MAX_CODE_ATTEMPTS = 3
const WELCOME_EXPIRY_DAYS = 30

/**
 * Create the hardcoded-fallback welcome coupon used when a restaurant has no
 * welcome-campaign mapping. Always stamped non-chargeable.
 */
export async function createWelcomeCoupon(
  restaurantId: string,
  memberId: string
): Promise<{ code: string; id: string }> {
  const expiresAt = new Date(
    Date.now() + WELCOME_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCouponCode()
    try {
      const coupon = await createCoupon({
        restaurantId,
        type: 'welcome',
        code,
        memberId,
        expiresAt,
        maxUses: 1,
        // Welcome coupons are ALWAYS non-chargeable, regardless of mapping.
        isChargeable: false,
      })
      return { code: coupon.code, id: coupon.id }
    } catch (err) {
      if (!(err as Error).message.includes('unique')) throw err
    }
  }

  throw new Error('Failed to generate unique coupon code after 3 attempts')
}

/**
 * Create a coupon seeded from a campaign's couponConfig + template. The
 * coupon's chargeability is STAMPED from the campaign's current
 * is_chargeable value at insert time — remapping the welcome campaign
 * later does NOT rewrite existing coupons.
 */
export async function createCampaignCoupon(
  restaurantId: string,
  memberId: string,
  campaign: Campaign,
  memberName: string
): Promise<{ code: string; id: string }> {
  if (!campaign.couponConfig) {
    throw new Error('Campaign has no coupon_config')
  }

  const expiresAt = new Date(
    Date.now() + campaign.couponConfig.expiresInDays * 24 * 60 * 60 * 1000
  ).toISOString()

  const discount = formatDiscount(campaign.couponConfig)

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCouponCode()
    const description = renderTemplate(campaign.template, {
      name: memberName,
      code,
      discount,
    })
    try {
      const coupon = await createCoupon({
        restaurantId,
        type: 'promo',
        code,
        memberId,
        expiresAt,
        maxUses: 1,
        discountType: campaign.couponConfig.discountType,
        discountValue: campaign.couponConfig.discountValue,
        campaignId: campaign.id,
        isChargeable: campaign.isChargeable,
        title: campaign.name ?? null,
        description,
      })
      return { code: coupon.code, id: coupon.id }
    } catch (err) {
      if (!(err as Error).message.includes('unique')) throw err
    }
  }

  throw new Error('Failed to generate unique coupon code after 3 attempts')
}

function formatDiscount(config: {
  discountType: string
  discountValue: number
}): string {
  if (config.discountType === 'percentage') return `${config.discountValue}%`
  return `HK$${config.discountValue}`
}
