import { Campaign, CouponConfig } from '@/domain/entities/campaign'

export interface CreateCampaignParams {
  restaurantId: string
  name: string
  type: Campaign['type']
  template: string
  couponConfig?: CouponConfig | null
  schedule?: Record<string, unknown> | null
  scheduledAt?: string | null
  whatsappTemplateId?: string | null
  targetAudience?: Campaign['targetAudience']
  status?: Campaign['status']
}

export interface UpdateCampaignParams {
  name?: string
  template?: string
  couponConfig?: CouponConfig | null
  schedule?: Record<string, unknown> | null
  scheduledAt?: string | null
  whatsappTemplateId?: string | null
  targetAudience?: Campaign['targetAudience']
  status?: Campaign['status']
}

export function mapRowToCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as string,
    name: (row.name as string) ?? null,
    type: row.type as Campaign['type'],
    template: row.template as string,
    couponConfig: (row.coupon_config as CouponConfig) ?? null,
    schedule: (row.schedule as Record<string, unknown>) ?? null,
    scheduledAt: (row.scheduled_at as string) ?? null,
    status: row.status as Campaign['status'],
    isChargeable: (row.is_chargeable as boolean | undefined) ?? true,
    chargeableSentCount: Number(row.chargeable_sent_count ?? 0),
    nonChargeableSentCount: Number(row.non_chargeable_sent_count ?? 0),
    redeemedCount: Number(row.redeemed_count ?? 0),
    whatsappTemplateId: (row.whatsapp_template_id as string) ?? null,
    targetAudience:
      (row.target_audience as Campaign['targetAudience']) ?? 'all',
    createdAt: row.created_at as string,
  }
}
