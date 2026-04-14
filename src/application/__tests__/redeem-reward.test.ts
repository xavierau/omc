import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/reward-repository', () => ({
  getRewardById: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  createCoupon: vi.fn(),
}))

vi.mock('@/domain/value-objects/coupon-code', () => ({
  generateCouponCode: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/storage', () => ({
  uploadCouponQr: vi.fn(),
}))

vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(),
  sendImageMessage: vi.fn(),
}))

vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  adjustMemberPoints: vi.fn(),
}))

const mockSingle = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ from: mockFrom })),
}))

import { redeemRewardUseCase } from '@/application/redeem-reward'
import { getRewardById } from '@/infrastructure/supabase/repositories/reward-repository'
import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { emitEvent } from '@/application/emit-event'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'

function buildReward(overrides = {}) {
  return {
    id: 'rw-1',
    name: 'Free Coffee',
    pointsCost: 50,
    isActive: true,
    discountType: 'percentage' as const,
    discountValue: 100,
    couponExpiryDays: 30,
    ...overrides,
  }
}

const defaultParams = {
  memberId: 'm-1',
  rewardId: 'rw-1',
  restaurantId: 'r-1',
  phone: '85291234567',
  phoneNumberId: 'phone-id-1',
}

function setupMemberBalance(balance: number) {
  mockFrom.mockReturnValue({ select: mockSelect })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockEq.mockReturnValue({ single: mockSingle })
  mockSingle.mockResolvedValue({
    data: { points_balance: balance },
    error: null,
  })
}

describe('redeemRewardUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateCouponCode).mockReturnValue('RWD-CODE01')
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
    vi.mocked(adjustMemberPoints).mockResolvedValue(50)
  })

  it('returns failure when reward is not found', async () => {
    vi.mocked(getRewardById).mockResolvedValue(null)

    const result = await redeemRewardUseCase(defaultParams)

    expect(result).toEqual({ success: false, message: 'Reward not found.' })
  })

  it('returns failure when reward is inactive', async () => {
    vi.mocked(getRewardById).mockResolvedValue(
      buildReward({ isActive: false })
    )

    const result = await redeemRewardUseCase(defaultParams)

    expect(result).toEqual({ success: false, message: 'Reward not found.' })
  })

  it('returns failure when member has insufficient points', async () => {
    vi.mocked(getRewardById).mockResolvedValue(buildReward({ pointsCost: 200 }))
    setupMemberBalance(100)

    const result = await redeemRewardUseCase(defaultParams)

    expect(result.success).toBe(false)
    expect(result.message).toContain('Not enough points')
    expect(result.message).toContain('100')
    expect(result.message).toContain('200')
  })

  it('deducts points, creates coupon, sends messages, and returns success', async () => {
    vi.mocked(getRewardById).mockResolvedValue(buildReward())
    setupMemberBalance(100)

    const result = await redeemRewardUseCase(defaultParams)

    expect(result).toEqual({ success: true, couponCode: 'RWD-CODE01' })
    expect(adjustMemberPoints).toHaveBeenCalledWith('m-1', -50, { rejectNegative: true })
    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'r-1',
        type: 'reward',
        code: 'RWD-CODE01',
        memberId: 'm-1',
        maxUses: 1,
        discountType: 'percentage',
        discountValue: 100,
      })
    )
    expect(sendTextMessage).toHaveBeenCalledWith(
      'phone-id-1',
      '85291234567',
      expect.stringContaining('Free Coffee')
    )
    expect(sendImageMessage).toHaveBeenCalledWith(
      'phone-id-1',
      '85291234567',
      'https://qr.example.com/img.png',
      expect.stringContaining('RWD-CODE01')
    )
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'r-1',
        memberId: 'm-1',
        type: 'reward_redeem',
      })
    )
  })

  it('retries coupon code generation on unique constraint error', async () => {
    vi.mocked(getRewardById).mockResolvedValue(buildReward())
    setupMemberBalance(100)
    vi.mocked(generateCouponCode)
      .mockReturnValueOnce('DUPE-CODE')
      .mockReturnValueOnce('UNIQUE-CODE')
    vi.mocked(createCoupon)
      .mockRejectedValueOnce(new Error('unique constraint violation'))
      .mockResolvedValueOnce(undefined)

    const result = await redeemRewardUseCase(defaultParams)

    expect(result).toEqual({ success: true, couponCode: 'UNIQUE-CODE' })
    expect(generateCouponCode).toHaveBeenCalledTimes(2)
    expect(createCoupon).toHaveBeenCalledTimes(2)
  })
})
