import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/coupon-factory')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/supabase/repositories/event-repository')
vi.mock('@/infrastructure/supabase/repositories/coupon-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/redis/welcome-claim-lock')

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
import { hasWelcomeCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { getRestaurantEmailContext } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { attemptWelcomeClaimLock, waitForWelcomeClaimLock } from '@/infrastructure/redis/welcome-claim-lock'
import { registerMemberWeb } from '../register-member-web'

const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()
const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockMaybeSingle })
const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
const mockInsertSingle = vi.fn()
const mockInsertSelect = vi.fn().mockReturnValue({ single: mockInsertSingle })
const mockInsert = vi.fn().mockReturnValue({ select: mockInsertSelect })
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, insert: mockInsert })
const mockSupabase = { from: mockFrom }

const lockRelease = vi.fn<() => Promise<void>>()

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
    // r1 F7: reset (not just clear) the mocks a test may make stateful.
    vi.mocked(emitEvent).mockReset().mockResolvedValue(undefined as never)
    vi.mocked(getCampaignById).mockResolvedValue(null)
    vi.mocked(incrementCampaignSent).mockResolvedValue(undefined)
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
    // WONB-020 r2 G5: the web path must never consult these; reset so a
    // call is visible.
    vi.mocked(hasJoinEvent).mockReset().mockResolvedValue(true)
    vi.mocked(hasWelcomeCoupon).mockReset().mockResolvedValue(false)
    vi.mocked(getRestaurantEmailContext).mockResolvedValue({ name: 'Poppy', whatsappNumber: '+85261234567' })
    lockRelease.mockReset().mockResolvedValue(undefined)
    vi.mocked(attemptWelcomeClaimLock).mockReset().mockResolvedValue({ kind: 'acquired', lease: { release: lockRelease } })
    vi.mocked(waitForWelcomeClaimLock).mockReset().mockResolvedValue(null)
  })

  it('returns isNew=false for existing member without touching coupon code', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'm-1' }, error: null })

    const result = await registerMemberWeb(VALID_PHONE, 'Alice', RESTAURANT_ID)

    // WONB-020 r2 G5: every existing member gets the same WhatsApp link.
    expect(result).toEqual({ isNew: false, memberId: 'm-1', whatsappClaimUrl: 'https://wa.me/85261234567?text=JOIN' })
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

    expect(result).toEqual({ isNew: false, memberId: 'm-existing', whatsappClaimUrl: 'https://wa.me/85261234567?text=JOIN' })
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
      'Carol',
      { welcomeOffer: true }
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

  // WONB-020 r1 F1 (owner ruling 2026-11-20): the web form can't prove phone
  // ownership, so it never mints for an existing member; WhatsApp JOIN claims.
  // r2 G5: the answer is the same for EVERY existing member (never welcomed,
  // welcomed, holding a welcome coupon), so the public endpoint does not
  // reveal who was imported or welcomed; no claim lookups on this path.
  describe('WONB-020 r2 G5: every existing member gets the same WhatsApp link', () => {
    const IMPORTED = { id: 'm-imp' }
    const LINKED = { isNew: false, memberId: 'm-imp', whatsappClaimUrl: 'https://wa.me/85261234567?text=JOIN' }

    function nothingMintedOrLookedUp() {
      expect(createWelcomeCoupon).not.toHaveBeenCalled()
      expect(createCampaignCoupon).not.toHaveBeenCalled()
      expect(incrementCampaignSent).not.toHaveBeenCalled()
      expect(emitEvent).not.toHaveBeenCalled()
      expect(mockInsert).not.toHaveBeenCalled()
      expect(hasJoinEvent).not.toHaveBeenCalled()
      expect(hasWelcomeCoupon).not.toHaveBeenCalled()
    }

    it.each([
      ['never welcomed (no join event, no coupon)', false, false],
      ['already welcomed (join event)', true, false],
      ['holding a welcome coupon', false, true],
    ])('AC-5: %s -> identical result, no lookups, nothing minted', async (_label, joined, coupon) => {
      vi.mocked(hasJoinEvent).mockResolvedValue(joined)
      vi.mocked(hasWelcomeCoupon).mockResolvedValue(coupon)
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const result = await registerMemberWeb(VALID_PHONE, 'Ivy', RESTAURANT_ID)

      expect(result).toEqual(LINKED)
      expect(getRestaurantEmailContext).toHaveBeenCalledWith(RESTAURANT_ID)
      nothingMintedOrLookedUp()
    })

    it('AC-5: submitted twice -> the same link, still zero coupons and zero join events', async () => {
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      await registerMemberWeb(VALID_PHONE, 'Ivy', RESTAURANT_ID)
      const second = await registerMemberWeb(VALID_PHONE, 'Ivy', RESTAURANT_ID)

      expect(second).toEqual(LINKED)
      nothingMintedOrLookedUp()
    })

    it('AC-5: no usable WhatsApp number -> plain existing, no link', async () => {
      vi.mocked(getRestaurantEmailContext).mockResolvedValue({ name: 'Poppy', whatsappNumber: null })
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })
      mockSingle.mockResolvedValueOnce({ data: IMPORTED, error: null })

      const none = await registerMemberWeb(VALID_PHONE, 'Ivy', RESTAURANT_ID)
      vi.mocked(getRestaurantEmailContext).mockResolvedValue({ name: 'Poppy', whatsappNumber: '12' })
      const bad = await registerMemberWeb(VALID_PHONE, 'Ivy', RESTAURANT_ID)

      expect(none).toEqual({ isNew: false, memberId: 'm-imp' })
      expect(bad).toEqual({ isNew: false, memberId: 'm-imp' })
      nothingMintedOrLookedUp()
    })

    it('AC-5: a new member is unchanged -> coupon minted, join event, {isNew:true, couponCode}', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })

      const result = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

      expect(result).toEqual({ isNew: true, memberId: 'm-new', couponCode: 'WLCM01' })
      expect(createWelcomeCoupon).toHaveBeenCalledTimes(1)
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-new', type: 'join' }))
      expect(hasJoinEvent).not.toHaveBeenCalled()
    })
  })
  // WONB-020 r4 H1 / H3.
  describe('r4: new-member lock and the race branch', () => {
    const CLAIM_URL = 'https://wa.me/85261234567?text=JOIN'

    function newMemberRows() {
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })
    }

    it('AC-2: takes the lock for the new member before the mint and releases it after the join event', async () => {
      newMemberRows()

      const result = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

      expect(result).toEqual({ isNew: true, memberId: 'm-new', couponCode: 'WLCM01' })
      expect(attemptWelcomeClaimLock).toHaveBeenCalledWith(RESTAURANT_ID, 'm-new')
      const acquired = vi.mocked(attemptWelcomeClaimLock).mock.invocationCallOrder[0]
      expect(acquired).toBeLessThan(vi.mocked(createWelcomeCoupon).mock.invocationCallOrder[0])
      expect(vi.mocked(emitEvent).mock.invocationCallOrder[0]).toBeLessThan(lockRelease.mock.invocationCallOrder[0])
      expect(lockRelease).toHaveBeenCalledTimes(1)
    })

    it('AC-2: the mint throws -> the lock is still released', async () => {
      newMemberRows()
      vi.mocked(createWelcomeCoupon).mockRejectedValueOnce(new Error('coupon insert failed'))

      await expect(registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)).rejects.toThrow('coupon insert failed')
      expect(lockRelease).toHaveBeenCalledTimes(1)
    })

    it('AC-2: lock unavailable (Redis down) -> still minted with a join event, with a warning (fail open)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(attemptWelcomeClaimLock).mockResolvedValueOnce({ kind: 'unavailable' })
      newMemberRows()

      const result = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

      expect(result).toEqual({ isNew: true, memberId: 'm-new', couponCode: 'WLCM01' })
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-new', type: 'join' }))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('welcome lock unavailable'), 'm-new')
      expect(lockRelease).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    // r6 J2 (supersedes r4's "held -> existing answer at once"): wait for the
    // WhatsApp claim, then re-check under the lock.
    describe('r6 J2: lock held -> wait, then re-check under the lock', () => {
      const waitedRelease = vi.fn<() => Promise<void>>()

      beforeEach(() => {
        waitedRelease.mockReset().mockResolvedValue(undefined)
        vi.mocked(attemptWelcomeClaimLock).mockResolvedValueOnce({ kind: 'held' })
        vi.mocked(hasJoinEvent).mockResolvedValue(false)
        newMemberRows()
      })

      it('AC-3: released, and the claim welcomed the member -> the existing-member answer, no mint', async () => {
        vi.mocked(waitForWelcomeClaimLock).mockResolvedValueOnce({ release: waitedRelease })
        vi.mocked(hasJoinEvent).mockResolvedValue(true)

        const result = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

        expect(result).toEqual({ isNew: false, memberId: 'm-new', whatsappClaimUrl: CLAIM_URL })
        expect(waitForWelcomeClaimLock).toHaveBeenCalledWith(RESTAURANT_ID, 'm-new')
        expect(createWelcomeCoupon).not.toHaveBeenCalled()
        expect(createCampaignCoupon).not.toHaveBeenCalled()
        expect(emitEvent).not.toHaveBeenCalled()
        expect(waitedRelease).toHaveBeenCalledTimes(1)
      })

      it('AC-3: released, a welcome coupon on file -> the existing-member answer, no mint', async () => {
        vi.mocked(waitForWelcomeClaimLock).mockResolvedValueOnce({ release: waitedRelease })
        vi.mocked(hasWelcomeCoupon).mockResolvedValueOnce(true)

        const result = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

        expect(result).toEqual({ isNew: false, memberId: 'm-new', whatsappClaimUrl: CLAIM_URL })
        expect(createWelcomeCoupon).not.toHaveBeenCalled()
        expect(waitedRelease).toHaveBeenCalledTimes(1)
      })

      it('AC-3: released, not welcomed -> minted once with a join event under the lock', async () => {
        vi.mocked(waitForWelcomeClaimLock).mockResolvedValueOnce({ release: waitedRelease })

        const result = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

        expect(result).toEqual({ isNew: true, memberId: 'm-new', couponCode: 'WLCM01' })
        expect(createWelcomeCoupon).toHaveBeenCalledTimes(1)
        expect(emitEvent).toHaveBeenCalledTimes(1)
        expect(vi.mocked(waitForWelcomeClaimLock).mock.invocationCallOrder[0]).toBeLessThan(
          vi.mocked(createWelcomeCoupon).mock.invocationCallOrder[0]
        )
        expect(vi.mocked(emitEvent).mock.invocationCallOrder[0]).toBeLessThan(waitedRelease.mock.invocationCallOrder[0])
        expect(waitedRelease).toHaveBeenCalledTimes(1)
      })

      it('AC-3: still held after the wait -> the existing-member answer, no mint, with a warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(waitForWelcomeClaimLock).mockResolvedValueOnce(null)

        const result = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

        expect(result).toEqual({ isNew: false, memberId: 'm-new', whatsappClaimUrl: CLAIM_URL })
        expect(createWelcomeCoupon).not.toHaveBeenCalled()
        expect(createCampaignCoupon).not.toHaveBeenCalled()
        expect(emitEvent).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('still held'), 'm-new')
        warn.mockRestore()
      })

      it('AC-3: the welcomed lookup errors after the acquire -> the existing-member answer, no mint, lock released', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(waitForWelcomeClaimLock).mockResolvedValueOnce({ release: waitedRelease })
        vi.mocked(hasJoinEvent).mockRejectedValue(new Error('db down'))

        const result = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

        expect(result).toEqual({ isNew: false, memberId: 'm-new', whatsappClaimUrl: CLAIM_URL })
        expect(createWelcomeCoupon).not.toHaveBeenCalled()
        expect(emitEvent).not.toHaveBeenCalled()
        expect(waitedRelease).toHaveBeenCalledTimes(1)
        warn.mockRestore()
      })
    })

    it('AC-2 (H3): the createOrGetMember race (outcome existing) -> the same answer as any existing member', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockInsertSingle.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      })
      mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'm-race', status: 'active' }, error: null })
      const raced = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)
      mockSingle.mockResolvedValueOnce({ data: { id: 'm-race' }, error: null })
      const prechecked = await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

      expect(raced).toEqual({ isNew: false, memberId: 'm-race', whatsappClaimUrl: CLAIM_URL })
      expect(raced).toEqual(prechecked)
      expect(createWelcomeCoupon).not.toHaveBeenCalled()
      expect(emitEvent).not.toHaveBeenCalled()
      expect(attemptWelcomeClaimLock).not.toHaveBeenCalled()
    })

    it('AC-3: the welcome-campaign mint passes welcomeOffer: true', async () => {
      vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
        welcomeCampaignId: 'camp-1',
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'zh_hk',
      })
      vi.mocked(getCampaignById).mockResolvedValueOnce(buildCampaign())
      newMemberRows()

      await registerMemberWeb(VALID_PHONE, 'Bob', RESTAURANT_ID)

      expect(createCampaignCoupon).toHaveBeenCalledWith(RESTAURANT_ID, 'm-new', expect.anything(), 'Bob', { welcomeOffer: true })
    })
  })
})
