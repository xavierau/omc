import { Coupon } from '@/domain/entities/coupon'
import { isValidCouponCode } from '@/domain/value-objects/coupon-code'
import { createCoupon, CreateCouponParams } from '@/infrastructure/supabase/repositories/coupon-repository'

export interface CreateCouponInput {
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

export type CreateCouponResult =
  | { success: true; coupon: Coupon }
  | { success: false; message: string }

export async function createCouponUseCase(
  input: CreateCouponInput
): Promise<CreateCouponResult> {
  if (!isValidCouponCode(input.code)) {
    return { success: false, message: 'Invalid coupon code format. Use 3-20 alphanumeric characters.' }
  }

  if (input.discountValue !== undefined && input.discountValue !== null && input.discountValue < 0) {
    return { success: false, message: 'Discount value must be non-negative.' }
  }

  if (input.maxUses !== undefined && input.maxUses !== null && input.maxUses < 1) {
    return { success: false, message: 'Max uses must be at least 1.' }
  }

  const params: CreateCouponParams = {
    restaurantId: input.restaurantId,
    type: input.type,
    code: input.code.toUpperCase(),
    memberId: input.memberId,
    expiresAt: input.expiresAt,
    discountType: input.discountType,
    discountValue: input.discountValue,
    maxUses: input.maxUses,
    description: input.description,
  }

  const coupon = await createCoupon(params)
  return { success: true, coupon }
}
