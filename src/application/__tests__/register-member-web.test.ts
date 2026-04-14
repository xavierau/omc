import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/coupon-repository')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { createCoupon, createWelcomeCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { emitEvent } from '@/application/emit-event'
import { getCampaignById } from '@/infrastructure/supabase/repositories/campaign-repository'
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

describe('registerMemberWeb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)
    vi.mocked(createWelcomeCoupon).mockResolvedValue({ code: 'WLCM01', id: 'c-1' } as never)
    vi.mocked(createCoupon).mockResolvedValue({ code: 'PROMO1', id: 'c-2' } as never)
    vi.mocked(emitEvent).mockResolvedValue(undefined as never)
    vi.mocked(getCampaignById).mockResolvedValue(null as never)
  })

  it('returns isNew false for existing member', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'm-1' }, error: null })

    const result = await registerMemberWeb(VALID_PHONE, 'Alice', RESTAURANT_ID)

    expect(result).toEqual({ isNew: false, memberId: 'm-1' })
    expect(createWelcomeCoupon).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('creates welcome coupon for new member without campaignId', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

    const result = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

    expect(result).toEqual({ isNew: true, memberId: 'm-new', couponCode: 'WLCM01' })
    expect(createWelcomeCoupon).toHaveBeenCalledWith(RESTAURANT_ID, 'm-new')
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        memberId: 'm-new',
        type: 'join',
        dataJson: expect.objectContaining({ source: 'web', campaign_id: null }),
      })
    )
  })

  it('creates campaign coupon for new member with campaignId', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })
    vi.mocked(getCampaignById).mockResolvedValueOnce({
      id: 'camp-1',
      name: 'Summer Promo',
      template: 'Hi {{name}}, use {{code}} for {{discount}} off!',
      couponConfig: {
        expiresInDays: 30,
        discountType: 'percentage',
        discountValue: 10,
      },
    } as never)

    const result = await registerMemberWeb(VALID_PHONE, 'Carol', RESTAURANT_ID, 'camp-1')

    expect(result.isNew).toBe(true)
    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        memberId: 'm-new',
        type: 'promo',
        campaignId: 'camp-1',
        discountType: 'percentage',
        discountValue: 10,
        maxUses: 1,
        title: 'Summer Promo',
      })
    )
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        dataJson: expect.objectContaining({ campaign_id: 'camp-1' }),
      })
    )
  })

  it('throws for invalid phone number', async () => {
    await expect(registerMemberWeb('12', 'Dan', RESTAURANT_ID)).rejects.toThrow(
      'Invalid phone number'
    )
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
