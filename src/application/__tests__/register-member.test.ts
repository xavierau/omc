import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/coupon-repository')
vi.mock('@/infrastructure/supabase/repositories/coupon-factory')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/whatsapp/messaging')
vi.mock('@/infrastructure/supabase/storage')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  createWelcomeCoupon,
  createCampaignCoupon,
} from '@/infrastructure/supabase/repositories/coupon-factory'
import { emitEvent } from '@/application/emit-event'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  getCampaignById,
  incrementCampaignSent,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { registerMember } from '../register-member'
import type { Campaign } from '@/domain/entities/campaign'
import { okResult } from '@/test-utils/send-result'

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
const PHONE_NUMBER_ID = 'pn-1'
const VALID_PHONE = '+85291234567'

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-welcome',
    restaurantId: RESTAURANT_ID,
    name: 'Welcome',
    type: 'welcome',
    template: 'Hi {{contactName}}, here is your code: {{couponCode}}',
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

describe('registerMember', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue(PHONE_NUMBER_ID)
    vi.mocked(sendTextMessage).mockResolvedValue(okResult())
    vi.mocked(sendImageMessage).mockResolvedValue(okResult())
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
    vi.mocked(createWelcomeCoupon).mockResolvedValue({ code: 'WELCOME1', id: 'c-1' })
    vi.mocked(createCampaignCoupon).mockResolvedValue({ code: 'MAPPED1', id: 'c-2' })
    vi.mocked(emitEvent).mockResolvedValue(undefined as never)
    vi.mocked(incrementCampaignSent).mockResolvedValue(undefined)
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })
    vi.mocked(getCampaignById).mockResolvedValue(null)
  })

  it('returns isNew=false and sends default greeting for existing unnamed member', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'm-1', points_balance: 50, name: null },
      error: null,
    })

    const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

    expect(result).toEqual({ isNew: false, memberId: 'm-1', pointsBalance: 50 })
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      expect.stringContaining('Welcome back!')
    )
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      expect.stringContaining('50 points')
    )
  })

  it('uses localized zh_hk greeting when default_language is zh_hk', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: '{{greeting}}，您有 {{points}} 積分',
      defaultLanguage: 'zh_hk',
    })
    mockSingle.mockResolvedValueOnce({
      data: { id: 'm-3', points_balance: 42, name: '大文' },
      error: null,
    })

    await registerMember(RESTAURANT_ID, VALID_PHONE)

    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      '歡迎回來，大文！，您有 42 積分'
    )
    expect(sendTextMessage).not.toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      expect.stringContaining('Welcome back,')
    )
  })

  it('uses returning_member_template when configured', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: 'Welcome home {{greeting}} — {{points}} pts',
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })
    mockSingle.mockResolvedValueOnce({
      data: { id: 'm-2', points_balance: 100, name: 'Alice' },
      error: null,
    })

    await registerMember(RESTAURANT_ID, VALID_PHONE)

    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      'Welcome home Welcome back, Alice! — 100 pts'
    )
  })

  it('includes name in default greeting for existing named member', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'm-2', points_balance: 100, name: 'Alice' },
      error: null,
    })

    await registerMember(RESTAURANT_ID, VALID_PHONE)

    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      expect.stringContaining('Welcome back, Alice!')
    )
  })

  it('creates new member with hardcoded welcome when no welcome campaign is mapped', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

    const result = await registerMember(RESTAURANT_ID, VALID_PHONE, 'Bob')

    expect(result).toEqual({
      isNew: true,
      memberId: 'm-new',
      pointsBalance: 0,
      couponCode: 'WELCOME1',
    })
    expect(createWelcomeCoupon).toHaveBeenCalledWith(RESTAURANT_ID, 'm-new')
    // Enrollment-time loyalty QR coverage (plan §4.3, subtask 13): a brand-new
    // member always gets a scannable hex loyalty_token at insert.
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ loyalty_token: expect.stringMatching(/^[0-9a-f]{32}$/) })
    )
    expect(createCampaignCoupon).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: RESTAURANT_ID, memberId: 'm-new', type: 'join' })
    )
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      'Welcome to our loyalty program, Bob!\n\nYou\'ve received a welcome gift!\nUse code: WELCOME1\n\nReply POINTS to check balance, or send a receipt photo to earn points.'
    )
  })

  it('uses mapped welcome campaign: renders template, creates campaign coupon, increments non-chargeable counter', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-welcome',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })
    vi.mocked(getCampaignById).mockResolvedValueOnce(buildCampaign())
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

    const result = await registerMember(RESTAURANT_ID, VALID_PHONE, 'Carol')

    expect(result.couponCode).toBe('MAPPED1')
    expect(createCampaignCoupon).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'm-new',
      expect.objectContaining({ id: 'camp-welcome', isChargeable: false }),
      'Carol'
    )
    expect(createWelcomeCoupon).not.toHaveBeenCalled()
    expect(incrementCampaignSent).toHaveBeenCalledWith('camp-welcome', false)
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      'Hi Carol, here is your code: MAPPED1'
    )
  })

  it('falls back to hardcoded welcome coupon when campaign mint fails (e.g. missing coupon_config)', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-welcome',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })
    vi.mocked(getCampaignById).mockResolvedValueOnce(buildCampaign())
    vi.mocked(createCampaignCoupon).mockRejectedValueOnce(
      new Error('Campaign has no coupon_config')
    )
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

    const result = await registerMember(RESTAURANT_ID, VALID_PHONE, 'Carol')

    expect(result.couponCode).toBe('WELCOME1')
    expect(createCampaignCoupon).toHaveBeenCalled()
    expect(createWelcomeCoupon).toHaveBeenCalledWith(RESTAURANT_ID, 'm-new')
    expect(incrementCampaignSent).not.toHaveBeenCalled()
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: RESTAURANT_ID, memberId: 'm-new', type: 'join' })
    )
    // Campaign text still used (with fallback coupon code substituted)
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      'Hi Carol, here is your code: WELCOME1'
    )
  })

  it('falls back to hardcoded text when mapped welcome campaign is missing', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-missing',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })
    vi.mocked(getCampaignById).mockResolvedValueOnce(null)
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

    const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

    expect(result.couponCode).toBe('WELCOME1')
    expect(createWelcomeCoupon).toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
  })

  it('catches coupon QR upload failure gracefully', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })
    vi.mocked(uploadCouponQr).mockRejectedValueOnce(new Error('upload failed'))

    const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

    expect(result.isNew).toBe(true)
    expect(result.memberId).toBe('m-new')
  })

  it('throws for invalid phone number', async () => {
    await expect(registerMember(RESTAURANT_ID, '123')).rejects.toThrow('Invalid phone number')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  describe('language detection on JOIN', () => {
    it('persists preferred_language=zh_hk when JOIN arrives with Chinese text', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: null,
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'en',
      })
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({
        data: { id: 'm-zh' },
        error: null,
      })

      await registerMember(RESTAURANT_ID, VALID_PHONE, 'Carol', '你好 JOIN')

      // insert was called with preferred_language='zh_hk'
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ preferred_language: 'zh_hk' })
      )
      // Welcome sent in ZH even though restaurant default is EN
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        expect.stringContaining('歡迎加入')
      )
    })

    it('persists preferred_language=en when JOIN arrives with English-only text', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: null,
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'zh_hk',
      })
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({
        data: { id: 'm-en' },
        error: null,
      })

      await registerMember(RESTAURANT_ID, VALID_PHONE, 'Dan', 'JOIN')

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ preferred_language: 'en' })
      )
      // Welcome sent in EN even though restaurant default is ZH
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        expect.stringContaining('Welcome to our loyalty program')
      )
    })

    it('does NOT persist preferred_language when inbound is emoji-only (welcome uses restaurant default)', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: null,
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'zh_hk',
      })
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({
        data: { id: 'm-emoji' },
        error: null,
      })

      await registerMember(RESTAURANT_ID, VALID_PHONE, 'Eve', '😀👍')

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ preferred_language: null })
      )
      // Welcome falls back to restaurant default (zh_hk)
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        expect.stringContaining('歡迎加入')
      )
    })

  })

  describe('welcome campaign image attachment (ONBOARD-010)', () => {
    it('sends image+caption as ONE message when EN image present and member EN', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: 'camp-welcome',
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'en',
      })
      vi.mocked(getCampaignById).mockResolvedValueOnce(
        buildCampaign({
          templateEn: 'Hi {{contactName}}, code {{couponCode}}',
          imageUrlEn: 'https://cdn.test/welcome-en.jpg',
          imageUrlZhHk: null,
        })
      )
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({
        data: { id: 'm-img-en' },
        error: null,
      })

      await registerMember(RESTAURANT_ID, VALID_PHONE, 'Ivy', 'JOIN')

      // Image send: welcome text as the caption (one unified message).
      expect(sendImageMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        'https://cdn.test/welcome-en.jpg',
        'Hi Ivy, code MAPPED1'
      )
      // Text welcome should NOT have been sent separately.
      expect(sendTextMessage).not.toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        'Hi Ivy, code MAPPED1'
      )
      // QR coupon still sent (second message with caption).
      expect(sendImageMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        'https://qr.example.com/img.png',
        expect.stringContaining('MAPPED1')
      )
    })

    it('STRICT: member EN but only ZH image → text-only welcome, no image substitution', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: 'camp-welcome',
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'en',
      })
      vi.mocked(getCampaignById).mockResolvedValueOnce(
        buildCampaign({
          templateEn: 'Hi {{contactName}}, code {{couponCode}}',
          imageUrlEn: null,
          imageUrlZhHk: 'https://cdn.test/welcome-zh.jpg',
        })
      )
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({
        data: { id: 'm-strict' },
        error: null,
      })

      await registerMember(RESTAURANT_ID, VALID_PHONE, 'Jack', 'JOIN')

      // No welcome-image-as-caption send (only QR image send exists).
      expect(sendImageMessage).not.toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        'https://cdn.test/welcome-zh.jpg',
        expect.anything()
      )
      // Text welcome IS sent as-is.
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        'Hi Jack, code MAPPED1'
      )
    })

    it('sends ZH image+caption when member ZH and ZH image present', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: 'camp-welcome',
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'zh_hk',
      })
      vi.mocked(getCampaignById).mockResolvedValueOnce(
        buildCampaign({
          templateZhHk: '你好 {{contactName}}，代碼 {{couponCode}}',
          imageUrlEn: null,
          imageUrlZhHk: 'https://cdn.test/welcome-zh.jpg',
        })
      )
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({
        data: { id: 'm-zh-img' },
        error: null,
      })

      await registerMember(RESTAURANT_ID, VALID_PHONE, '大文', '你好 JOIN')

      expect(sendImageMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        'https://cdn.test/welcome-zh.jpg',
        '你好 大文，代碼 MAPPED1'
      )
      expect(sendTextMessage).not.toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        '你好 大文，代碼 MAPPED1'
      )
    })

    it('campaign has no images → text welcome + QR (regression of existing behavior)', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: 'camp-welcome',
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'en',
      })
      vi.mocked(getCampaignById).mockResolvedValueOnce(
        buildCampaign({
          templateEn: 'Hi {{contactName}}, code {{couponCode}}',
          imageUrlEn: null,
          imageUrlZhHk: null,
        })
      )
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({
        data: { id: 'm-no-img' },
        error: null,
      })

      await registerMember(RESTAURANT_ID, VALID_PHONE, 'Kim', 'JOIN')

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        'Hi Kim, code MAPPED1'
      )
    })

    it('returning member with preferred_language=en overrides restaurant default zh_hk', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: null,
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'zh_hk',
      })
      mockSingle.mockResolvedValueOnce({
        data: {
          id: 'm-r',
          points_balance: 77,
          name: 'Frank',
          preferred_language: 'en',
        },
        error: null,
      })

      await registerMember(RESTAURANT_ID, VALID_PHONE)

      // English Welcome back wins over zh_hk restaurant default
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        expect.stringContaining('Welcome back, Frank!')
      )
    })
  })
})
