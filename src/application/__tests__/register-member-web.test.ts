import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/coupon-factory')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/supabase/repositories/event-repository')

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
import { hasJoinEvent } from '@/infrastructure/supabase/repositories/event-repository'
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
    failureReason: null,
    isChargeable: false,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: null,
    targetAudience: 'all',
    createdAt: '2026-04-20T00:00:00Z',
    lastEnqueuedAt: null,
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
    // WONB-020: existing members in the tests above already have a join
    // event; the claim block below overrides this.
    vi.mocked(hasJoinEvent).mockResolvedValue(true)
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

  // G-3 (Grok review): same fix as register-member.ts -- see that test
  // file's own G-3 comment for the full mechanism.
  it('G-3: a dotted phone format the legacy PhoneNumber VO accepted no longer 500s on the web QR join path', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

    const result = await registerMemberWeb('+852.9123.4567', 'Bob', RESTAURANT_ID)

    expect(result).toEqual({ isNew: true, memberId: 'm-new', couponCode: 'WLCM01' })
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+85291234567' })
    )
  })

  // N-9 (WI-17, confirmation review): the pre-check used to query by the
  // un-repaired `phone.value` -- a member first created via the G-3
  // fallback (stored NORMALISED) missed its own pre-check on a second join
  // with the same raw dotted input.
  it('N-9: the pre-check queries by the RESOLVED value, so a second join with the same dotted raw input returns the returning-member flow', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'm-existing' }, error: null })

    const result = await registerMemberWeb('+852.9123.4567', 'Bob', RESTAURANT_ID)

    expect(result).toEqual({ isNew: false, memberId: 'm-existing' })
    expect(mockEq2).toHaveBeenCalledWith('phone', '+85291234567')
    expect(mockEq2).not.toHaveBeenCalledWith('phone', '+852.9123.4567')
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

  // WONB-020: web join form for an existing member with no `join` event
  // (e.g. CSV-imported) mints the welcome coupon once.
  describe('WONB-020: existing member with no join event claims the welcome offer', () => {
    const IMPORTED = { id: 'm-imp', name: 'Ivy' }

    it('AC-3: mints the welcome coupon, emits the join event after the mint, returns the code', async () => {
      vi.mocked(hasJoinEvent).mockResolvedValueOnce(false)
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const result = await registerMemberWeb(VALID_PHONE, 'Typed Name', RESTAURANT_ID)

      expect(result).toEqual({ isNew: false, memberId: 'm-imp', couponCode: 'WLCM01' })
      expect(hasJoinEvent).toHaveBeenCalledWith(RESTAURANT_ID, 'm-imp')
      expect(mockInsert).not.toHaveBeenCalled()
      expect(createWelcomeCoupon).toHaveBeenCalledTimes(1)
      expect(createWelcomeCoupon).toHaveBeenCalledWith(RESTAURANT_ID, 'm-imp')
      expect(emitEvent).toHaveBeenCalledWith({
        restaurantId: RESTAURANT_ID,
        memberId: 'm-imp',
        type: 'join',
        dataJson: { source: 'web', coupon_code: 'WLCM01', campaign_id: null },
      })
      const mintOrder = vi.mocked(createWelcomeCoupon).mock.invocationCallOrder[0]
      const joinOrder = vi.mocked(emitEvent).mock.invocationCallOrder[0]
      expect(mintOrder).toBeLessThan(joinOrder)
    })

    it('AC-3: uses the mapped welcome campaign with the stored name (form name when none stored)', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValue({
        welcomeCampaignId: 'camp-1',
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'zh_hk',
      })
      vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
      vi.mocked(hasJoinEvent).mockResolvedValue(false)
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })
      mockSingle.mockResolvedValueOnce({ data: { id: 'm-imp2', name: null }, error: null })

      const stored = await registerMemberWeb(VALID_PHONE, 'Typed Name', RESTAURANT_ID)
      const unnamed = await registerMemberWeb(VALID_PHONE, 'Typed Name', RESTAURANT_ID)

      expect(stored.couponCode).toBe('PROMO1')
      expect(unnamed.couponCode).toBe('PROMO1')
      expect(createCampaignCoupon).toHaveBeenNthCalledWith(1, RESTAURANT_ID, 'm-imp', expect.objectContaining({ id: 'camp-1' }), 'Ivy')
      expect(createCampaignCoupon).toHaveBeenNthCalledWith(2, RESTAURANT_ID, 'm-imp2', expect.objectContaining({ id: 'camp-1' }), 'Typed Name')
      expect(incrementCampaignSent).toHaveBeenCalledWith('camp-1', false)
    })

    it('AC-3: a member WITH a join event stays isNew=false with no coupon', async () => {
      vi.mocked(hasJoinEvent).mockResolvedValueOnce(true)
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const result = await registerMemberWeb(VALID_PHONE, 'Ivy', RESTAURANT_ID)

      expect(result).toEqual({ isNew: false, memberId: 'm-imp' })
      expect(createWelcomeCoupon).not.toHaveBeenCalled()
      expect(createCampaignCoupon).not.toHaveBeenCalled()
      expect(emitEvent).not.toHaveBeenCalled()
    })

    it('AC-4: after the claim writes its join event, a second submission gets no second coupon', async () => {
      let joined = false
      vi.mocked(emitEvent).mockImplementation(async (e) => {
        if (e.type === 'join') joined = true
        return undefined as never
      })
      vi.mocked(hasJoinEvent).mockImplementation(async () => joined)
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const first = await registerMemberWeb(VALID_PHONE, 'Ivy', RESTAURANT_ID)
      const second = await registerMemberWeb(VALID_PHONE, 'Ivy', RESTAURANT_ID)

      expect(first.couponCode).toBe('WLCM01')
      expect(second).toEqual({ isNew: false, memberId: 'm-imp' })
      expect(createWelcomeCoupon).toHaveBeenCalledTimes(1)
    })

    it('AC-5: a join-event lookup failure mints nothing and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(hasJoinEvent).mockRejectedValueOnce(new Error('hasJoinEvent: timeout'))
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const result = await registerMemberWeb(VALID_PHONE, 'Ivy', RESTAURANT_ID)

      expect(result).toEqual({ isNew: false, memberId: 'm-imp' })
      expect(createWelcomeCoupon).not.toHaveBeenCalled()
      expect(createCampaignCoupon).not.toHaveBeenCalled()
      expect(emitEvent).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('join-event lookup failed'), expect.anything())
      warn.mockRestore()
    })
  })
})
