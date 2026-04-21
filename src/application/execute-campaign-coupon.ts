import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { Campaign, CouponConfig } from '@/domain/entities/campaign'
import { Member } from '@/domain/entities/member'

/**
 * Mint the coupon row for a single campaign-broadcast recipient. Split out
 * of the batch orchestrator so both files stay within the 150-line limit.
 */
export async function createCampaignBroadcastCoupon(
  campaign: Campaign,
  member: Member,
  code: string,
  description: string
): Promise<void> {
  const config = campaign.couponConfig
  const expiresAt = config
    ? new Date(Date.now() + config.expiresInDays * 86400000).toISOString()
    : null

  await createCoupon({
    restaurantId: campaign.restaurantId,
    type: 'promo',
    code,
    memberId: member.id,
    campaignId: campaign.id,
    expiresAt,
    discountType: config?.discountType ?? null,
    discountValue: config?.discountValue ?? null,
    maxUses: 1,
    isChargeable: campaign.isChargeable,
    title: campaign.name ?? null,
    description,
  })
}

export function formatDiscount(config: CouponConfig | null): string {
  if (!config) return ''
  if (config.discountType === 'percentage') return `${config.discountValue}%`
  return `HK$${config.discountValue}`
}
