import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { Campaign, CouponConfig } from '@/domain/entities/campaign'
import { Member } from '@/domain/entities/member'
import { Coupon } from '@/domain/entities/coupon'

/**
 * Mint the coupon row for a single campaign-broadcast recipient. Split out
 * of the batch orchestrator so both files stay within the 150-line limit.
 *
 * Returns the created {@link Coupon}. The eager broadcast path (Stream A)
 * awaits and ignores it; the lazy claim path (CAMP-001) needs the row to
 * send the QR back to the customer.
 */
export async function createCampaignBroadcastCoupon(
  campaign: Campaign,
  member: Pick<Member, 'id'>,
  code: string,
  description: string
): Promise<Coupon> {
  const config = campaign.couponConfig
  const expiresAt = config
    ? new Date(Date.now() + config.expiresInDays * 86400000).toISOString()
    : null

  return createCoupon({
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
