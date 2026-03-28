import { Coupon } from '@/domain/entities/coupon'

export function mapRowToCoupon(row: Record<string, unknown>): Coupon {
  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as string,
    type: row.type as Coupon['type'],
    code: row.code as string,
    status: row.status as Coupon['status'],
    memberId: (row.member_id as string) ?? null,
    expiresAt: (row.expires_at as string) ?? null,
    redeemedAt: (row.redeemed_at as string) ?? null,
    discountType: (row.discount_type as Coupon['discountType']) ?? null,
    discountValue: row.discount_value ? Number(row.discount_value) : null,
    maxUses: row.max_uses ? Number(row.max_uses) : null,
    currentUses: Number(row.current_uses ?? 0),
    isActive: row.is_active as boolean,
    description: (row.description as string) ?? null,
    createdAt: row.created_at as string,
  }
}

export interface CreateCouponParams {
  restaurantId: string
  type: Coupon['type']
  code: string
  memberId?: string | null
  expiresAt?: string | null
  discountType?: Coupon['discountType']
  discountValue?: number | null
  maxUses?: number | null
  description?: string | null
}

export interface ListCouponsParams {
  restaurantId: string
  page: number
  pageSize: number
  type?: Coupon['type']
  isActive?: boolean
}

export interface ListCouponsResult {
  coupons: Coupon[]
  total: number
}
