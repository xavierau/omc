export interface Reward {
  id: string
  restaurantId: string
  name: string
  pointsCost: number
  discountType: 'percentage' | 'fixed_amount'
  discountValue: number
  couponExpiryDays: number
  isActive: boolean
  sortOrder: number
}
