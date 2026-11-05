import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  listCoupons: vi.fn(),
}))

import { listCouponsUseCase } from '@/application/list-coupons'
import { listCoupons } from '@/infrastructure/supabase/repositories/coupon-repository'

describe('listCouponsUseCase', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('passes all params to repository and returns result', async () => {
    const mockResult = { coupons: [], total: 0 }
    vi.mocked(listCoupons).mockResolvedValue(mockResult)

    const input = {
      restaurantId: 'r-1',
      page: 2,
      pageSize: 10,
      type: 'promo' as const,
      isActive: true,
    }

    const result = await listCouponsUseCase(input)

    expect(result).toEqual(mockResult)
    expect(listCoupons).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      page: 2,
      pageSize: 10,
      type: 'promo',
      isActive: true,
    })
  })
})
