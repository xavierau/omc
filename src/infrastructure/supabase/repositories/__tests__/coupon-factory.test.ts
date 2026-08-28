import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'

vi.mock('../coupon-repository', () => ({
  createCoupon: vi.fn(),
}))

vi.mock('@/domain/value-objects/coupon-code', () => ({
  generateCouponCode: vi.fn(() => 'CODE123'),
}))

import { createWelcomeCoupon, createCampaignCoupon } from '../coupon-factory'
import { createCoupon } from '../coupon-repository'

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    restaurantId: 'rest-1',
    name: 'Welcome Campaign',
    type: 'welcome',
    template: 'Hi {{name}}, use {{code}} for {{discount}} off!',
    templateEn: null,
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: {
      discountType: 'percentage',
      discountValue: 10,
      expiresInDays: 30,
    },
    schedule: null,
    scheduledAt: null,
    status: 'active',
    failureReason: null,
    isChargeable: false,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: null,
    targetAudience: 'all',
    createdAt: '2026-04-20T00:00:00Z',
    ...overrides,
  }
}

describe('createWelcomeCoupon', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stamps isChargeable=false on the coupon it creates', async () => {
    vi.mocked(createCoupon).mockResolvedValue({
      id: 'c-1',
      code: 'CODE123',
      restaurantId: 'rest-1',
      type: 'welcome',
      status: 'active',
      memberId: 'm-1',
      expiresAt: null,
      redeemedAt: null,
      discountType: null,
      discountValue: null,
      maxUses: 1,
      currentUses: 0,
      isActive: true,
      isChargeable: false,
      title: null,
      description: null,
      campaignId: null,
      createdAt: '2026-04-20T00:00:00Z',
    })

    await createWelcomeCoupon('rest-1', 'm-1')

    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'welcome', isChargeable: false })
    )
  })
})

describe('createCampaignCoupon', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stamps isChargeable=false when the source campaign is non-chargeable', async () => {
    vi.mocked(createCoupon).mockResolvedValue({
      id: 'c-2',
      code: 'CODE123',
    } as never)
    const campaign = buildCampaign({ isChargeable: false })

    await createCampaignCoupon('rest-1', 'm-1', campaign, 'Alice')

    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ isChargeable: false, campaignId: 'camp-1' })
    )
  })

  it('stamps isChargeable=true when the source campaign is chargeable', async () => {
    vi.mocked(createCoupon).mockResolvedValue({
      id: 'c-3',
      code: 'CODE123',
    } as never)
    const campaign = buildCampaign({ isChargeable: true, type: 'promo' })

    await createCampaignCoupon('rest-1', 'm-1', campaign, 'Alice')

    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ isChargeable: true })
    )
  })

  it('renders the campaign template with name/code/discount placeholders', async () => {
    vi.mocked(createCoupon).mockResolvedValue({
      id: 'c-4',
      code: 'CODE123',
    } as never)
    const campaign = buildCampaign()

    await createCampaignCoupon('rest-1', 'm-1', campaign, 'Alice')

    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Hi Alice, use CODE123 for 10% off!',
      })
    )
  })

  it('throws when the campaign lacks coupon_config', async () => {
    const campaign = buildCampaign({ couponConfig: null })

    await expect(
      createCampaignCoupon('rest-1', 'm-1', campaign, 'Alice')
    ).rejects.toThrow('Campaign has no coupon_config')
  })

  it('formats fixed_amount discount as HK$', async () => {
    vi.mocked(createCoupon).mockResolvedValue({
      id: 'c-5',
      code: 'CODE123',
    } as never)
    const campaign = buildCampaign({
      template: 'Get {{discount}} off',
      couponConfig: {
        discountType: 'fixed_amount',
        discountValue: 50,
        expiresInDays: 30,
      },
    })

    await createCampaignCoupon('rest-1', 'm-1', campaign, 'Alice')

    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Get HK$50 off' })
    )
  })
})
