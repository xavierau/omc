import { Coupon } from '@/domain/entities/coupon'
import { listCoupons, ListCouponsResult } from '@/infrastructure/supabase/repositories/coupon-repository'

export interface ListCouponsInput {
  restaurantId: string
  page: number
  pageSize: number
  type?: Coupon['type']
  isActive?: boolean
}

export async function listCouponsUseCase(
  input: ListCouponsInput
): Promise<ListCouponsResult> {
  return listCoupons({
    restaurantId: input.restaurantId,
    page: input.page,
    pageSize: input.pageSize,
    type: input.type,
    isActive: input.isActive,
  })
}
