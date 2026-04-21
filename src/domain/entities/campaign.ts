export interface Campaign {
  id: string
  restaurantId: string
  name: string | null
  type: 'welcome' | 'winback' | 'birthday' | 'promo'
  /**
   * Legacy single-value template. Kept during the rolling-deploy window for
   * read-path compatibility; ONBOARD-005b will drop the column. New code
   * should prefer `templateEn` / `templateZhHk` via `resolveLocalizedTemplate`.
   */
  template: string
  templateEn: string | null
  templateZhHk: string | null
  couponConfig: CouponConfig | null
  schedule: Record<string, unknown> | null
  scheduledAt: string | null
  status: 'draft' | 'active' | 'sending' | 'paused' | 'completed'
  isChargeable: boolean
  chargeableSentCount: number
  nonChargeableSentCount: number
  redeemedCount: number
  whatsappTemplateId: string | null
  targetAudience: 'all' | 'selected'
  createdAt: string
}

export interface CouponConfig {
  discountType: 'percentage' | 'fixed_amount'
  discountValue: number
  expiresInDays: number
}
