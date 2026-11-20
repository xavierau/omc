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
vi.mock('@/infrastructure/supabase/repositories/event-repository')
vi.mock('@/infrastructure/redis/welcome-claim-lock')

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
import { hasJoinEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { hasWelcomeCoupon, findLatestWelcomeOfferCode } from '@/infrastructure/supabase/repositories/coupon-repository'
import { attemptWelcomeClaimLock, tryAcquireWelcomeClaimLock } from '@/infrastructure/redis/welcome-claim-lock'
import { registerMember } from '../register-member'
import type { Campaign } from '@/domain/entities/campaign'
import { okResult, failResult } from '@/test-utils/send-result'

const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()
// N-9 (WI-17): extended to also expose maybeSingle -- insertMember's own
// 23505 re-select (member-create-repository.ts's selectMemberByPhone) uses
// `.eq().eq().maybeSingle()`, the SAME chain shape as this file's
// findExistingMember/findMemberByPhone `.single()` calls, since every
// `.from('members')` call in these tests routes through this ONE shared
// mock. Additive only -- no existing test calls maybeSingle, so this
// changes nothing for them.
const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockMaybeSingle })
const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
const mockInsertSingle = vi.fn()
const mockInsertSelect = vi.fn().mockReturnValue({ single: mockInsertSingle })
const mockInsert = vi.fn().mockReturnValue({ select: mockInsertSelect })
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, insert: mockInsert })
const mockSupabase = { from: mockFrom }

const lockRelease = vi.fn<() => Promise<void>>()
const newMemberRelease = vi.fn<() => Promise<void>>()

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
    // r1 F7: reset (not just clear) the mocks a test may make stateful, so no
    // implementation or unconsumed Once value leaks into the next test.
    vi.mocked(emitEvent).mockReset()
    vi.mocked(hasJoinEvent).mockReset()
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
    // WONB-020: existing members in the tests above already have a join
    // event (welcome-back); the claim block below overrides this.
    vi.mocked(hasJoinEvent).mockResolvedValue(true)
    vi.mocked(hasWelcomeCoupon).mockResolvedValue(false)
    vi.mocked(findLatestWelcomeOfferCode).mockReset().mockResolvedValue(null)
    lockRelease.mockReset().mockResolvedValue(undefined)
    vi.mocked(tryAcquireWelcomeClaimLock).mockReset().mockResolvedValue({ release: lockRelease })
    newMemberRelease.mockReset().mockResolvedValue(undefined)
    vi.mocked(attemptWelcomeClaimLock)
      .mockReset()
      .mockResolvedValue({ kind: 'acquired', lease: { release: newMemberRelease } })
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

  // G-3 (Grok review): WI-7's seam refactor wraps `PhoneNumber.create`'s
  // output in `E164Phone.of`, a STRICT format assertion. `PhoneNumber.create`
  // only strips `[\s\-()]` -- it keeps dots -- so a raw phone like
  // "+852.9123.4567" (which the OLD pre-seam code accepted, since it never
  // ran through a strict E.164 check) now throws uncaught inside
  // `E164Phone.of`, 500-ing the whole WhatsApp join with no member created.
  // Fixed by falling back to the robust `parseE164Phone` (the SAME parser
  // the partner API path already uses) when the strict path throws --
  // repairs a legacy-accepted format into a valid E.164 instead of
  // crashing, without weakening validation for genuinely invalid input.
  it('G-3: a dotted phone format the legacy PhoneNumber VO accepted no longer 500s -- parsed via the fallback and the member is created with the clean E.164 value', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

    const result = await registerMember(RESTAURANT_ID, '+852.9123.4567', 'Bob')

    expect(result).toEqual({
      isNew: true,
      memberId: 'm-new',
      pointsBalance: 0,
      couponCode: 'WELCOME1',
    })
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+85291234567' })
    )
  })

  // N-9 (WI-17, confirmation review): the pre-check (findExistingMember)
  // and the race re-select (findMemberByPhone) used to look up by the
  // un-repaired `phone.value` -- so a member first created via the G-3
  // fallback (stored NORMALISED) missed both lookups on a second join with
  // the same raw legacy input, and the race branch threw "race on create
  // but no row found" -> 500, even though the member genuinely existed.
  describe('N-9: pre-check and race re-select use the RESOLVED E.164 value, not the raw legacy phone', () => {
    it('the pre-check queries by the RESOLVED value for a dotted legacy phone', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

      await registerMember(RESTAURANT_ID, '+852.9123.4567', 'Bob')

      expect(mockEq2).toHaveBeenCalledWith('phone', '+85291234567')
      expect(mockEq2).not.toHaveBeenCalledWith('phone', '+852.9123.4567')
    })

    it('a genuine race (pre-check misses, insert hits 23505) re-selects by the RESOLVED value -- returns the returning-member flow instead of throwing/500', async () => {
      // Pre-check: misses (another request is mid-insert for this number).
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      // insertMember's own INSERT attempt hits the unique index.
      mockInsertSingle.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      })
      // insertMember's OWN re-select (member-create-repository.ts, fed the
      // resolved E164Phone by createOrGetMember) finds the row -- this leg
      // was already correct before this fix.
      mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'm-race', status: 'active' }, error: null })
      // registerMember's OWN re-select (findMemberByPhone) -- THIS fix's
      // target: only succeeds if it queries by the resolved value too.
      mockSingle.mockResolvedValueOnce({
        data: { id: 'm-race', points_balance: 10, name: 'Bob', preferred_language: null },
        error: null,
      })

      const result = await registerMember(RESTAURANT_ID, '+852.9123.4567', 'Bob')

      expect(result).toEqual({ isNew: false, memberId: 'm-race', pointsBalance: 10 })
      expect(mockEq2).not.toHaveBeenCalledWith('phone', '+852.9123.4567')
      expect(mockEq2).toHaveBeenCalledWith('phone', '+85291234567')
    })
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
      'Carol',
      { welcomeOffer: true }
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

  // WONB-020: an existing member with no `join` event (e.g. CSV-imported,
  // which writes only `consent_imported`) was never welcomed -- the first
  // JOIN claims the welcome flow once; later JOINs are welcome-back.
  describe('WONB-020: existing member with no join event claims the welcome offer', () => {
    const IMPORTED = { id: 'm-imp', points_balance: 0, name: 'Ivy', preferred_language: 'zh_hk' }

    function welcomeBackSent(): boolean {
      return vi.mocked(sendTextMessage).mock.calls.some(
        ([, , text]) => /Welcome back|歡迎回來/.test(String(text))
      )
    }

    it('AC-1: runs the welcome flow (coupon + welcome + QR) once with the stored name and language, no welcome-back', async () => {
      vi.mocked(hasJoinEvent).mockResolvedValue(false)
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const result = await registerMember(RESTAURANT_ID, VALID_PHONE, 'WaProfileName')

      expect(result).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 0, couponCode: 'WELCOME1' })
      expect(hasJoinEvent).toHaveBeenCalledWith(RESTAURANT_ID, 'm-imp')
      expect(createWelcomeCoupon).toHaveBeenCalledTimes(1)
      expect(createWelcomeCoupon).toHaveBeenCalledWith(RESTAURANT_ID, 'm-imp')
      expect(mockInsert).not.toHaveBeenCalled()
      expect(emitEvent).toHaveBeenCalledTimes(1)
      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: RESTAURANT_ID, memberId: 'm-imp', type: 'join' })
      )
      // zh_hk default welcome text (stored language), addressed by the STORED name
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        expect.stringMatching(/Ivy[\s\S]*WELCOME1/)
      )
      expect(sendTextMessage).not.toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        VALID_PHONE,
        expect.stringContaining('WaProfileName')
      )
      expect(sendImageMessage).toHaveBeenCalledTimes(1)
      expect(welcomeBackSent()).toBe(false)
    })

    it('AC-1: falls back to the WhatsApp contact name when the stored name is null', async () => {
      vi.mocked(hasJoinEvent).mockResolvedValue(false)
      vi.mocked(getOnboardingSettings).mockResolvedValue({
        welcomeCampaignId: 'camp-welcome',
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'en',
      })
      vi.mocked(getCampaignById).mockResolvedValueOnce(buildCampaign())
      mockSingle.mockResolvedValueOnce({ data: { ...IMPORTED, name: null, preferred_language: null }, error: null })

      const result = await registerMember(RESTAURANT_ID, VALID_PHONE, 'Carol')

      expect(result.couponCode).toBe('MAPPED1')
      expect(createCampaignCoupon).toHaveBeenCalledWith(
        RESTAURANT_ID,
        'm-imp',
        expect.objectContaining({ id: 'camp-welcome' }),
        'Carol',
        { welcomeOffer: true }
      )
      expect(sendTextMessage).toHaveBeenCalledWith(PHONE_NUMBER_ID, VALID_PHONE, 'Hi Carol, here is your code: MAPPED1')
    })

    it('AC-2: a member WITH a join event gets welcome-back only, no coupon, no lock', async () => {
      vi.mocked(hasJoinEvent).mockResolvedValue(true)
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

      expect(result).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 0 })
      expect(createWelcomeCoupon).not.toHaveBeenCalled()
      expect(createCampaignCoupon).not.toHaveBeenCalled()
      expect(emitEvent).not.toHaveBeenCalled()
      expect(tryAcquireWelcomeClaimLock).not.toHaveBeenCalled()
      expect(welcomeBackSent()).toBe(true)
    })

    it('AC-4 (r0): after the claim writes its join event, a second JOIN is welcome-back with no second coupon', async () => {
      // Stateful fake, reset in beforeEach (r1 F7).
      let joined = false
      vi.mocked(emitEvent).mockImplementation(async (e) => {
        if (e.type === 'join') joined = true
        return undefined as never
      })
      vi.mocked(hasJoinEvent).mockImplementation(async () => joined)
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const first = await registerMember(RESTAURANT_ID, VALID_PHONE)
      vi.mocked(sendTextMessage).mockClear()
      const second = await registerMember(RESTAURANT_ID, VALID_PHONE)

      expect(first.couponCode).toBe('WELCOME1')
      expect(second).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 0 })
      expect(createWelcomeCoupon).toHaveBeenCalledTimes(1)
      expect(welcomeBackSent()).toBe(true)
    })

    it('AC-5 (r0): a join-event lookup failure mints nothing, falls back to welcome-back and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(hasJoinEvent).mockRejectedValue(new Error('hasJoinEvent: connection reset'))
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

      expect(result).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 0 })
      expect(createWelcomeCoupon).not.toHaveBeenCalled()
      expect(createCampaignCoupon).not.toHaveBeenCalled()
      expect(welcomeBackSent()).toBe(true)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('lookup failed'), expect.anything())
      warn.mockRestore()
    })

    it('r1 F2: a member already holding a welcome coupon (join event write failed) gets welcome-back, no second mint', async () => {
      vi.mocked(hasJoinEvent).mockResolvedValue(false)
      vi.mocked(hasWelcomeCoupon).mockResolvedValue(true)
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

      expect(result).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 0 })
      expect(createWelcomeCoupon).not.toHaveBeenCalled()
      expect(welcomeBackSent()).toBe(true)
    })

    // r1 F3: the claim is serialised per (restaurant, member).
    describe('r1 F3: claim lock', () => {
      it('AC-4: takes the lock for (restaurant, member), mints once, then releases it', async () => {
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

        const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(result.couponCode).toBe('WELCOME1')
        expect(tryAcquireWelcomeClaimLock).toHaveBeenCalledWith(RESTAURANT_ID, 'm-imp')
        expect(lockRelease).toHaveBeenCalledTimes(1)
        const lockOrder = vi.mocked(tryAcquireWelcomeClaimLock).mock.invocationCallOrder[0]
        expect(lockOrder).toBeLessThan(vi.mocked(createWelcomeCoupon).mock.invocationCallOrder[0])
        expect(vi.mocked(createWelcomeCoupon).mock.invocationCallOrder[0]).toBeLessThan(lockRelease.mock.invocationCallOrder[0])
      })

      it('AC-4: lock not acquired (another JOIN is claiming) -> welcome-back, no mint, no release', async () => {
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        vi.mocked(tryAcquireWelcomeClaimLock).mockResolvedValue(null)
        mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

        const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(result).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 0 })
        expect(createWelcomeCoupon).not.toHaveBeenCalled()
        expect(createCampaignCoupon).not.toHaveBeenCalled()
        expect(emitEvent).not.toHaveBeenCalled()
        expect(lockRelease).not.toHaveBeenCalled()
        expect(welcomeBackSent()).toBe(true)
      })

      it('AC-4: Redis unavailable (the lock helper reads it as not acquired) -> welcome-back, no mint', async () => {
        // tryAcquireWelcomeClaimLock never throws: a Redis error resolves null
        // (welcome-claim-lock.test.ts); this is that answer at the use case.
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        vi.mocked(tryAcquireWelcomeClaimLock).mockResolvedValueOnce(null)
        mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

        await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(createWelcomeCoupon).not.toHaveBeenCalled()
        expect(welcomeBackSent()).toBe(true)
      })

      it('AC-4: claimability is re-checked after the lock: a join event written meanwhile -> welcome-back, no mint, lock released', async () => {
        vi.mocked(hasJoinEvent).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
        mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

        const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(result).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 0 })
        expect(hasJoinEvent).toHaveBeenCalledTimes(2)
        const recheck = vi.mocked(hasJoinEvent).mock.invocationCallOrder[1]
        expect(vi.mocked(tryAcquireWelcomeClaimLock).mock.invocationCallOrder[0]).toBeLessThan(recheck)
        expect(createWelcomeCoupon).not.toHaveBeenCalled()
        expect(lockRelease).toHaveBeenCalledTimes(1)
        expect(welcomeBackSent()).toBe(true)
      })
    })

    // r1 F4, superseded by r2 G1 (main ruling 2026-11-20): a failed claim
    // tells the member a code they now hold; with none on file it degrades
    // to their normal welcome-back.
    describe('r2 G1: claim failure recovery', () => {
      function minimalWelcomeSent(code?: string): boolean {
        return vi.mocked(sendTextMessage).mock.calls.some(([, , text]) =>
          /^(Welcome to our loyalty program!|歡迎加入我們的會員計劃！)/.test(String(text)) &&
          (code === undefined || String(text).includes(code))
        )
      }

      it('AC-1: coupon mint fails before any coupon exists -> welcome-back with the member points; lock released', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        vi.mocked(createWelcomeCoupon).mockRejectedValueOnce(new Error('coupon insert failed'))
        mockSingle.mockResolvedValueOnce({ data: { ...IMPORTED, points_balance: 120, preferred_language: 'en' }, error: null })

        const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(result).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 120 })
        expect(findLatestWelcomeOfferCode).toHaveBeenCalledWith(RESTAURANT_ID, 'm-imp')
        expect(emitEvent).not.toHaveBeenCalled()
        expect(sendTextMessage).toHaveBeenCalledTimes(1)
        const [, , text] = vi.mocked(sendTextMessage).mock.calls[0]
        expect(String(text)).toMatch(/Welcome back/)
        expect(String(text)).toContain('120')
        expect(minimalWelcomeSent()).toBe(false)
        expect(lockRelease).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('welcome claim failed'), expect.anything())
        warn.mockRestore()
      })

      it('AC-1: join event write fails after the mint -> minimal welcome text with the minted code, no welcome-back', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        vi.mocked(emitEvent).mockRejectedValue(new Error('events insert failed'))
        vi.mocked(findLatestWelcomeOfferCode).mockResolvedValue('WELCOME1')
        mockSingle.mockResolvedValueOnce({ data: { ...IMPORTED, points_balance: 40, preferred_language: 'en' }, error: null })

        const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(result).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 40, couponCode: 'WELCOME1' })
        expect(createWelcomeCoupon).toHaveBeenCalledTimes(1)
        expect(sendTextMessage).toHaveBeenCalledWith(
          PHONE_NUMBER_ID,
          VALID_PHONE,
          expect.stringMatching(/^Welcome to our loyalty program![\s\S]*Your welcome code: WELCOME1/)
        )
        expect(welcomeBackSent()).toBe(false)
        expect(lockRelease).toHaveBeenCalledTimes(1)
        warn.mockRestore()
      })

      it('AC-1: the recovery text uses the member language like onboarding (stored zh_hk over restaurant en)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        vi.mocked(emitEvent).mockRejectedValue(new Error('events insert failed'))
        vi.mocked(findLatestWelcomeOfferCode).mockResolvedValue('WELCOME1')
        mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

        await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(sendTextMessage).toHaveBeenCalledWith(
          PHONE_NUMBER_ID,
          VALID_PHONE,
          expect.stringMatching(/^歡迎加入我們的會員計劃！[\s\S]*WELCOME1/)
        )
        expect(welcomeBackSent()).toBe(false)
        warn.mockRestore()
      })

      it('AC-1: the recovery lookup errors -> welcome-back, no minimal welcome text', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        vi.mocked(emitEvent).mockRejectedValue(new Error('events insert failed'))
        vi.mocked(findLatestWelcomeOfferCode).mockRejectedValue(new Error('coupons timeout'))
        mockSingle.mockResolvedValueOnce({ data: { ...IMPORTED, preferred_language: 'en' }, error: null })

        const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(result).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 0 })
        expect(welcomeBackSent()).toBe(true)
        expect(minimalWelcomeSent()).toBe(false)
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('recovery failed'), expect.anything())
        warn.mockRestore()
      })

      it('AC-1: the recovery send throws -> welcome-back', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        vi.mocked(emitEvent).mockRejectedValue(new Error('events insert failed'))
        vi.mocked(findLatestWelcomeOfferCode).mockResolvedValue('WELCOME1')
        vi.mocked(sendTextMessage).mockImplementation(async (_p, _t, text) => {
          if (String(text).startsWith('Welcome to our loyalty program!')) throw new Error('kapso 500')
          return okResult()
        })
        mockSingle.mockResolvedValueOnce({ data: { ...IMPORTED, preferred_language: 'en' }, error: null })

        const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(result).toEqual({ isNew: false, memberId: 'm-imp', pointsBalance: 0 })
        expect(welcomeBackSent()).toBe(true)
        warn.mockRestore()
      })

      it('AC-1: the recovery send returns a non-OK result -> welcome-back', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        vi.mocked(emitEvent).mockRejectedValue(new Error('events insert failed'))
        vi.mocked(findLatestWelcomeOfferCode).mockResolvedValue('WELCOME1')
        vi.mocked(sendTextMessage).mockImplementation(async (_p, _t, text) =>
          String(text).startsWith('Welcome to our loyalty program!') ? failResult('rate_limited') : okResult()
        )
        mockSingle.mockResolvedValueOnce({ data: { ...IMPORTED, preferred_language: 'en' }, error: null })

        const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(result.couponCode).toBeUndefined()
        expect(welcomeBackSent()).toBe(true)
        warn.mockRestore()
      })

      it('a send fails inside onboarding (swallowed there) -> the claim stands, no recovery text', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        vi.mocked(uploadCouponQr).mockRejectedValueOnce(new Error('upload failed'))
        vi.mocked(sendImageMessage).mockRejectedValue(new Error('send failed'))
        vi.mocked(sendTextMessage)
          .mockRejectedValueOnce(new Error('send failed'))
          .mockResolvedValue(okResult())
        mockSingle.mockResolvedValueOnce({ data: { ...IMPORTED, preferred_language: 'en' }, error: null })

        const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

        // Sends are best-effort (onboard-send-helpers swallow their own
        // errors), so the claim may still succeed; either way no minimal
        // welcome text goes out on the claim path.
        expect(sendTextMessage).not.toHaveBeenCalledWith(
          PHONE_NUMBER_ID,
          VALID_PHONE,
          expect.stringMatching(/^Welcome to our loyalty program!/)
        )
        expect(result.memberId).toBe('m-imp')
        warn.mockRestore()
      })

      it('AC-5: the new-member failure path still sends the minimal welcome text (unchanged)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        mockSingle.mockResolvedValueOnce({ data: null, error: null })
        mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })
        vi.mocked(createWelcomeCoupon).mockRejectedValueOnce(new Error('coupon insert failed'))

        const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

        expect(result).toEqual({ isNew: true, memberId: 'm-new', pointsBalance: 0, couponCode: undefined })
        expect(sendTextMessage).toHaveBeenCalledWith(
          PHONE_NUMBER_ID,
          VALID_PHONE,
          expect.stringContaining('Welcome to our loyalty program!')
        )
        expect(welcomeBackSent()).toBe(false)
        expect(tryAcquireWelcomeClaimLock).not.toHaveBeenCalled()
        warn.mockRestore()
      })
    })
  })
  // WONB-020 r4 H1: the new-member path takes the same per-member lock as the
  // claim, so a second JOIN racing a brand-new member's onboarding can't mint.
  describe('r4 H1: new-member welcome lock', () => {
    function newMemberRows() {
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })
    }

    it('AC-1: takes the lock for the new member before the mint and releases it after the sends', async () => {
      newMemberRows()

      const result = await registerMember(RESTAURANT_ID, VALID_PHONE, 'Bob')

      expect(result.couponCode).toBe('WELCOME1')
      expect(attemptWelcomeClaimLock).toHaveBeenCalledWith(RESTAURANT_ID, 'm-new')
      expect(newMemberRelease).toHaveBeenCalledTimes(1)
      const acquired = vi.mocked(attemptWelcomeClaimLock).mock.invocationCallOrder[0]
      expect(acquired).toBeLessThan(vi.mocked(createWelcomeCoupon).mock.invocationCallOrder[0])
      const lastSend = vi.mocked(sendImageMessage).mock.invocationCallOrder[0]
      expect(lastSend).toBeLessThan(newMemberRelease.mock.invocationCallOrder[0])
      expect(vi.mocked(emitEvent).mock.invocationCallOrder[0]).toBeLessThan(newMemberRelease.mock.invocationCallOrder[0])
    })

    it('AC-1: onboarding throws -> fallback welcome sent and the lock still released', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      newMemberRows()
      vi.mocked(createWelcomeCoupon).mockRejectedValueOnce(new Error('coupon insert failed'))

      await registerMember(RESTAURANT_ID, VALID_PHONE)

      expect(newMemberRelease).toHaveBeenCalledTimes(1)
      warn.mockRestore()
    })

    it('AC-1: lock unavailable (Redis down) -> the new member is still onboarded, with a warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(attemptWelcomeClaimLock).mockResolvedValueOnce({ kind: 'unavailable' })
      newMemberRows()

      const result = await registerMember(RESTAURANT_ID, VALID_PHONE, 'Bob')

      expect(result).toEqual({ isNew: true, memberId: 'm-new', pointsBalance: 0, couponCode: 'WELCOME1' })
      expect(createWelcomeCoupon).toHaveBeenCalledTimes(1)
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-new', type: 'join' }))
      expect(sendImageMessage).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('welcome lock unavailable'), 'm-new')
      expect(newMemberRelease).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('lock held (a concurrent claim is welcoming this member) -> no mint, no join event, no send, warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(attemptWelcomeClaimLock).mockResolvedValueOnce({ kind: 'held' })
      newMemberRows()

      const result = await registerMember(RESTAURANT_ID, VALID_PHONE, 'Bob')

      expect(result).toEqual({ isNew: true, memberId: 'm-new', pointsBalance: 0 })
      expect(createWelcomeCoupon).not.toHaveBeenCalled()
      expect(createCampaignCoupon).not.toHaveBeenCalled()
      expect(emitEvent).not.toHaveBeenCalled()
      expect(sendTextMessage).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('concurrent welcome claim'), 'm-new')
      warn.mockRestore()
    })

    it('AC-1: a claim JOIN while the new-member onboarding holds the lock -> welcome-back, one coupon in total', async () => {
      // One in-memory lock shared by both entry points, as Redis would be.
      const held = new Set<string>()
      const take = (r: string, m: string) => (held.has(`${r}:${m}`) ? null : (held.add(`${r}:${m}`), `${r}:${m}`))
      vi.mocked(attemptWelcomeClaimLock).mockImplementation(async (r, m) => {
        const key = take(r, m)
        return key ? { kind: 'acquired', lease: { release: async () => void held.delete(key) } } : { kind: 'held' }
      })
      vi.mocked(tryAcquireWelcomeClaimLock).mockImplementation(async (r, m) => {
        const key = take(r, m)
        return key ? { release: async () => void held.delete(key) } : null
      })
      // The new member has no join event or coupon yet while it is onboarding.
      vi.mocked(hasJoinEvent).mockResolvedValue(false)
      let releaseMint!: () => void
      const mintGate = new Promise<void>((resolve) => (releaseMint = resolve))
      vi.mocked(createWelcomeCoupon).mockImplementationOnce(async () => {
        await mintGate
        return { code: 'WELCOME1', id: 'c-1' }
      })
      newMemberRows()

      const first = registerMember(RESTAURANT_ID, VALID_PHONE, 'Bob')
      await vi.waitFor(() => expect(createWelcomeCoupon).toHaveBeenCalledTimes(1))
      // Second JOIN: the pre-check now finds the row inserted by the first.
      mockSingle.mockResolvedValueOnce({ data: { id: 'm-new', points_balance: 0, name: 'Bob' }, error: null })
      const second = await registerMember(RESTAURANT_ID, VALID_PHONE, 'Bob')
      releaseMint()
      const firstResult = await first

      expect(firstResult.couponCode).toBe('WELCOME1')
      expect(second).toEqual({ isNew: false, memberId: 'm-new', pointsBalance: 0 })
      expect(createWelcomeCoupon).toHaveBeenCalledTimes(1)
      expect(createCampaignCoupon).not.toHaveBeenCalled()
      expect(vi.mocked(sendTextMessage).mock.calls.some(([, , t]) => /Welcome back/.test(String(t)))).toBe(true)
      expect(held.size).toBe(0)
    })
  })
})
