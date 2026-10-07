import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { mintAndDeliverReward } from '@/application/mint-and-deliver-reward'
import { Language } from '@/domain/value-objects/language'
import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'

function buildReward(overrides = {}) {
  return {
    id: 'rw-1',
    name: 'Free Coffee',
    pointsCost: 50,
    discountType: 'percentage' as const,
    discountValue: 100,
    couponExpiryDays: 30,
    ...overrides,
  }
}

function pointsParams(overrides = {}) {
  return {
    reward: buildReward(),
    restaurantId: 'r-1',
    memberId: 'm-1',
    phone: '85291234567',
    phoneNumberId: 'phone-id-1',
    language: Language.EN,
    source: 'points' as const,
    newBalance: 50,
    ...overrides,
  }
}

function stampParams(overrides = {}) {
  return {
    reward: buildReward(),
    restaurantId: 'r-1',
    memberId: 'm-1',
    phone: '85291234567',
    phoneNumberId: 'phone-id-1',
    language: Language.EN,
    source: 'stamp_campaign' as const,
    ...overrides,
  }
}

describe('mintAndDeliverReward', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateCouponCode).mockReturnValue('RWD-CODE01')
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
  })

  it('mints a single-use coupon and sends text + QR image', async () => {
    const code = await mintAndDeliverReward(pointsParams())

    expect(code).toBe('RWD-CODE01')
    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'r-1',
        type: 'reward',
        code: 'RWD-CODE01',
        memberId: 'm-1',
        maxUses: 1,
        discountType: 'percentage',
        discountValue: 100,
        description: 'Free Coffee',
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
  })

  it('points source includes the new balance in the celebration text', async () => {
    await mintAndDeliverReward(pointsParams({ newBalance: 42 }))

    const text = vi.mocked(sendTextMessage).mock.calls[0][2]
    expect(text).toContain('50 points')
    expect(text).toContain('42 points')
  })

  it('stamp_campaign source sends the no-points variant (no balance/points fields)', async () => {
    await mintAndDeliverReward(stampParams())

    const text = vi.mocked(sendTextMessage).mock.calls[0][2]
    expect(text).toContain('Free Coffee')
    expect(text).toContain('Stamp card complete')
    expect(text).not.toContain('points')
    expect(text).not.toContain('balance')
  })

  it('retries coupon code generation on a unique-constraint error', async () => {
    vi.mocked(generateCouponCode)
      .mockReturnValueOnce('DUPE-CODE')
      .mockReturnValueOnce('UNIQUE-CODE')
    vi.mocked(createCoupon)
      .mockRejectedValueOnce(new Error('unique constraint violation'))
      .mockResolvedValueOnce(undefined as never)

    const code = await mintAndDeliverReward(pointsParams())

    expect(code).toBe('UNIQUE-CODE')
    expect(createCoupon).toHaveBeenCalledTimes(2)
  })

  it('ZH stamp variant uses 印花卡儲滿', async () => {
    await mintAndDeliverReward(stampParams({ language: Language.ZH_HK }))

    const text = vi.mocked(sendTextMessage).mock.calls[0][2]
    expect(text).toContain('印花卡儲滿')
  })
})
