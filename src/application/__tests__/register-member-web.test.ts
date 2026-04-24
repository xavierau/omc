import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/coupon-factory')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  createCampaignCoupon,
  createWelcomeCoupon,
} from '@/infrastructure/supabase/repositories/coupon-factory'
import { emitEvent } from '@/application/emit-event'
import {
  getCampaignById,
  incrementCampaignSent,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { registerMemberWeb } from '../register-member-web'

const mockSingle = vi.fn()
const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
const mockInsertSingle = vi.fn()
const mockInsertSelect = vi.fn().mockReturnValue({ single: mockInsertSingle })
const mockInsert = vi.fn().mockReturnValue({ select: mockInsertSelect })
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, insert: mockInsert })
const mockSupabase = { from: mockFrom }

const RESTAURANT_ID = 'rest-1'
const VALID_PHONE = '+85291234567'

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    restaurantId: RESTAURANT_ID,
    name: 'Welcome Campaign',
    type: 'welcome',
    template: 'Hi {{name}}, use {{code}}',
    templateEn: null,
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 30 },
    schedule: null,
    scheduledAt: null,
    status: 'active',
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

describe('registerMemberWeb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)
    vi.mocked(createWelcomeCoupon).mockResolvedValue({ code: 'WLCM01', id: 'c-1' })
    vi.mocked(createCampaignCoupon).mockResolvedValue({ code: 'PROMO1', id: 'c-2' })
    vi.mocked(emitEvent).mockResolvedValue(undefined as never)
    vi.mocked(getCampaignById).mockResolvedValue(null)
    vi.mocked(incrementCampaignSent).mockResolvedValue(undefined)
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
  })

  it('returns isNew=false for existing member without touching coupon code', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'm-1' }, error: null })

    const result = await registerMemberWeb(VALID_PHONE, 'Alice', RESTAURANT_ID)

    expect(result).toEqual({ isNew: false, memberId: 'm-1' })
    expect(createWelcomeCoupon).not.toHaveBeenCalled()
    expect(createCampaignCoupon).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('falls back to welcome coupon when no welcome campaign is mapped', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

    const result = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

    expect(result).toEqual({ isNew: true, memberId: 'm-new', couponCode: 'WLCM01' })
    expect(createWelcomeCoupon).toHaveBeenCalledWith(RESTAURANT_ID, 'm-new')
    expect(createCampaignCoupon).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        dataJson: expect.objectContaining({ source: 'web', campaign_id: null }),
      })
    )
  })

  it('uses the mapped welcome campaign: creates campaign coupon and increments non-chargeable counter', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
    vi.mocked(getCampaignById).mockResolvedValueOnce(buildCampaign({ isChargeable: false }))
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

    const result = await registerMemberWeb(VALID_PHONE, 'Carol', RESTAURANT_ID)

    expect(result.couponCode).toBe('PROMO1')
    expect(createCampaignCoupon).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'm-new',
      expect.objectContaining({ id: 'camp-1', isChargeable: false }),
      'Carol'
    )
    expect(incrementCampaignSent).toHaveBeenCalledWith('camp-1', false)
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        dataJson: expect.objectContaining({ campaign_id: 'camp-1' }),
      })
    )
  })

  it('falls back to welcome coupon when mapped campaign fails to mint (e.g. missing coupon_config)', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
    vi.mocked(getCampaignById).mockResolvedValueOnce(buildCampaign())
    vi.mocked(createCampaignCoupon).mockRejectedValueOnce(new Error('no coupon_config'))
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

    const result = await registerMemberWeb(VALID_PHONE, 'Dan', RESTAURANT_ID)

    expect(result.couponCode).toBe('WLCM01')
    expect(createWelcomeCoupon).toHaveBeenCalledWith(RESTAURANT_ID, 'm-new')
  })

  it('throws for invalid phone number without touching the DB', async () => {
    await expect(registerMemberWeb('12', 'Eve', RESTAURANT_ID)).rejects.toThrow(
      'Invalid phone number'
    )
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
