export interface Campaign {
  id: string
  restaurantId: string
  name: string | null
  type: 'welcome' | 'winback' | 'birthday' | 'promo'
  template: string
  couponConfig: CouponConfig | null
  schedule: Record<string, unknown> | null
  scheduledAt: string | null
  status: 'draft' | 'active' | 'sending' | 'paused' | 'completed'
  sentCount: number
  redeemedCount: number
  whatsappTemplateId: string | null
  createdAt: string
}

export interface CouponConfig {
  discountType: 'percentage' | 'fixed_amount'
  discountValue: number
  expiresInDays: number
}
