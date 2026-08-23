/**
 * Integration-ish test for the ONBOARD-004 "remap preserves history" invariant.
 *
 * Flow under test (end-to-end across application use-cases, with
 * infrastructure mocked at the repository boundary):
 *
 *   1. Member A joins while Campaign A is the mapped welcome campaign.
 *      -> Campaign A increments non_chargeable_sent_count via RPC.
 *      -> Coupon A is stamped isChargeable=false (taken from Campaign A
 *         at the moment of mint).
 *
 *   2. Admin remaps welcome from Campaign A -> Campaign B.
 *      -> remap_welcome_campaign RPC flips A back to is_chargeable=true
 *         and B to is_chargeable=false.
 *
 *   3. Member B joins while Campaign B is the mapped welcome campaign.
 *      -> Campaign B increments non_chargeable_sent_count.
 *      -> Coupon B is stamped isChargeable=false.
 *
 *   4. Invariant check: Campaign A's prior counter bump and Coupon A's
 *      stamped chargeability are UNTOUCHED by the remap. No retroactive
 *      rewrite — billing history stays stable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/coupon-factory')
vi.mock('@/infrastructure/supabase/repositories/coupon-repository')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/application/emit-event')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  createCampaignCoupon,
  createWelcomeCoupon,
} from '@/infrastructure/supabase/repositories/coupon-factory'
import {
  getCampaignById,
  incrementCampaignSent,
  remapWelcomeCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import {
  getOnboardingSettings,
  updateOnboardingSettings,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { emitEvent } from '@/application/emit-event'
import { registerMemberWeb } from '../register-member-web'
import { updateOnboardingSettingsForTenant } from '../update-onboarding-settings'

const RESTAURANT_ID = 'rest-1'
const PHONE_A = '+85291111111'
const PHONE_B = '+85292222222'

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-a',
    restaurantId: RESTAURANT_ID,
    name: 'Welcome A',
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
    ...overrides,
  }
}

/**
 * Minimal supabase-client mock for the members existence/insert round-trip
 * used by registerMemberWeb. `exists` toggles whether the select-then-single
 * call returns a pre-existing member or null.
 */
function installSupabaseMock(opts: { existingMemberId: string | null; insertedId: string }) {
  const selectSingle = vi
    .fn()
    .mockResolvedValueOnce(
      opts.existingMemberId
        ? { data: { id: opts.existingMemberId }, error: null }
        : { data: null, error: null }
    )
  const selectEq2 = vi.fn().mockReturnValue({ single: selectSingle })
  const selectEq1 = vi.fn().mockReturnValue({ eq: selectEq2 })
  const select = vi.fn().mockReturnValue({ eq: selectEq1 })

  const insertSingle = vi
    .fn()
    .mockResolvedValueOnce({ data: { id: opts.insertedId }, error: null })
  const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
  const insert = vi.fn().mockReturnValue({ select: insertSelect })

  const from = vi.fn().mockReturnValue({ select, insert })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
}

describe('remap welcome campaign: preserves history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(emitEvent).mockResolvedValue(undefined as never)
    vi.mocked(createWelcomeCoupon).mockResolvedValue({ code: 'FALLBACK', id: 'c-fallback' })
    vi.mocked(incrementCampaignSent).mockResolvedValue(undefined)
    vi.mocked(remapWelcomeCampaign).mockResolvedValue(undefined)
    vi.mocked(updateOnboardingSettings).mockResolvedValue(undefined)
  })

  it('step 1: joining under campaign A increments A non-chargeable and stamps coupon with A.isChargeable', async () => {
    const campaignA = buildCampaign({ id: 'camp-a', isChargeable: false })
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-a',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
    vi.mocked(getCampaignById).mockResolvedValueOnce(campaignA)
    vi.mocked(createCampaignCoupon).mockResolvedValueOnce({ code: 'A-COUPON', id: 'coupon-a' })
    installSupabaseMock({ existingMemberId: null, insertedId: 'm-a' })

    const result = await registerMemberWeb(PHONE_A, 'Alice', RESTAURANT_ID)

    expect(result).toEqual({ isNew: true, memberId: 'm-a', couponCode: 'A-COUPON' })
    // Stamp: coupon-factory is called with the campaign carrying isChargeable=false.
    expect(createCampaignCoupon).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'm-a',
      expect.objectContaining({ id: 'camp-a', isChargeable: false }),
      'Alice'
    )
    // Counter: non-chargeable bucket incremented via atomic RPC.
    expect(incrementCampaignSent).toHaveBeenCalledWith('camp-a', false)
  })

  it('step 2: remap A -> B flips both campaigns atomically via RPC', async () => {
    const campaignB = buildCampaign({ id: 'camp-b', name: 'Welcome B' })
    vi.mocked(getCampaignById).mockResolvedValueOnce(campaignB)
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-a',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    await updateOnboardingSettingsForTenant(RESTAURANT_ID, { welcomeCampaignId: 'camp-b' })

    // Single atomic RPC. Not three separate round-trips.
    expect(remapWelcomeCampaign).toHaveBeenCalledTimes(1)
    expect(remapWelcomeCampaign).toHaveBeenCalledWith(RESTAURANT_ID, 'camp-a', 'camp-b')
  })

  it('step 3: joining under campaign B increments B (not A) and stamps coupon with B.isChargeable', async () => {
    const campaignB = buildCampaign({ id: 'camp-b', name: 'Welcome B', isChargeable: false })
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-b',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
    vi.mocked(getCampaignById).mockResolvedValueOnce(campaignB)
    vi.mocked(createCampaignCoupon).mockResolvedValueOnce({ code: 'B-COUPON', id: 'coupon-b' })
    installSupabaseMock({ existingMemberId: null, insertedId: 'm-b' })

    const result = await registerMemberWeb(PHONE_B, 'Bob', RESTAURANT_ID)

    expect(result.couponCode).toBe('B-COUPON')
    expect(createCampaignCoupon).toHaveBeenCalledWith(
      RESTAURANT_ID,
      'm-b',
      expect.objectContaining({ id: 'camp-b', isChargeable: false }),
      'Bob'
    )
    expect(incrementCampaignSent).toHaveBeenCalledWith('camp-b', false)
    // Critical: the remap did NOT cause a new increment against camp-a.
    expect(incrementCampaignSent).not.toHaveBeenCalledWith('camp-a', expect.anything())
  })

  it('invariant: remap never revisits prior coupon stamps or prior counter increments', async () => {
    // The stamping layer (coupon-factory) reads the campaign's CURRENT
    // isChargeable at mint time and writes it on the coupon row. The only
    // code path that mutates that stamp is... none. setCampaignChargeable /
    // remapWelcomeCampaign touch `campaigns.is_chargeable`, not
    // `coupons.is_chargeable`.
    //
    // This test pins the API surface: after a remap call, neither the
    // coupon factory nor incrementCampaignSent is invoked against the
    // previous campaign. (The real retroactive-rewrite guarantee lives in
    // the DB: migration 027 does NOT backfill coupons.is_chargeable on
    // remap. This test prevents regressions at the application layer.)
    vi.mocked(getCampaignById).mockResolvedValueOnce(
      buildCampaign({ id: 'camp-b', name: 'Welcome B' })
    )
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-a',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })

    await updateOnboardingSettingsForTenant(RESTAURANT_ID, { welcomeCampaignId: 'camp-b' })

    expect(createCampaignCoupon).not.toHaveBeenCalled()
    expect(createWelcomeCoupon).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
  })
})
