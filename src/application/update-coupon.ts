import { Coupon } from '@/domain/entities/coupon'
import { findCouponById, updateCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'

export interface UpdateCouponInput {
  id: string
  description?: string | null
  discountType?: Coupon['discountType']
  discountValue?: number | null
  maxUses?: number | null
  expiresAt?: string | null
  isActive?: boolean
}

export type UpdateCouponResult =
  | { success: true; coupon: Coupon }
  | { success: false; message: string }

export async function updateCouponUseCase(
  input: UpdateCouponInput
): Promise<UpdateCouponResult> {
  const existing = await findCouponById(input.id)
  if (!existing) {
    return { success: false, message: 'Coupon not found.' }
  }

  if (input.discountValue !== undefined && input.discountValue !== null && input.discountValue < 0) {
    return { success: false, message: 'Discount value must be non-negative.' }
  }

  if (input.maxUses !== undefined && input.maxUses !== null && input.maxUses < 1) {
    return { success: false, message: 'Max uses must be at least 1.' }
  }

  const { id, ...changes } = input
  const coupon = await updateCoupon(id, changes)
  return { success: true, coupon }
}
