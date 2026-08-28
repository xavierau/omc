import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Campaign, CouponConfig } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'

vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getCampaignById: vi.fn(),
  incrementCampaignSent: vi.fn(),
  updateCampaign: vi.fn(),
  transitionCampaignStatus: vi.fn(),
  // #131: a run that tallied sends completes through this CAS (a sent bucket
  // must still be > 0). Default true = no webhook retracted anything.
  completeCampaignRunIfCounted: vi.fn().mockResolvedValue(true),
  failCampaignRunIfSending: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/infrastructure/supabase/repositories/whatsapp-message-campaign-queries', () => ({
  findLatestCampaignFailure: vi.fn().mockResolvedValue(null),
  CAMPAIGN_BODY_MESSAGE_TYPES: ['template', 'text'],
}))

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  createCoupon: vi.fn(),
}))

// #131 / CAMP-002 re-run prefetch: default = first run (no ledger, no coupons).
vi.mock('@/infrastructure/supabase/repositories/coupon-campaign-queries', () => ({
  findCouponsByMembersAndCampaign: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('@/infrastructure/supabase/repositories/whatsapp-message-ledger-queries', () => ({
  findMemberIdsWithCountedSend: vi.fn().mockResolvedValue(new Set()),
}))

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantPhoneNumberId: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository', () => ({
  getRestaurantDefaultLanguage: vi.fn().mockResolvedValue('zh_hk'),
}))

vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(),
  sendImageMessage: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/whatsapp-message-repository', () => ({
  insertQueued: vi.fn(),
  attachKapsoMessageId: vi.fn(),
  markFailedNoBspId: vi.fn(),
  // WAQ-007 cooldown counters are re-exported from the repo file. They're
  // wired through the mocked cooldown-queries module below, but the mock
  // needs both surfaces present so dependents resolving via either path
  // get a function rather than undefined.
  countMarketingSendsLast24h: vi.fn().mockResolvedValue(0),
  countMarketingSendsLast24hForPhones: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  findActiveConsent: vi.fn(),
  findActiveMarketingConsentForPhones: vi.fn().mockResolvedValue(new Map()),
}))

// SendContext now plumbs the per-tenant cooldown cap (WAQ-007). Mock the
// settings repo so executeCampaign tests don't hit Supabase, and default to
// `null` (loader applies DEFAULT_PER_USER_MARKETING_CAP=1 for missing rows).
vi.mock('@/infrastructure/supabase/repositories/campaign-settings-repository', () => ({
  getSettingsForTenant: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/infrastructure/supabase/storage', () => ({
  uploadCouponQr: vi.fn(),
}))

vi.mock('@/domain/value-objects/coupon-code', () => ({
  generateCouponCode: vi.fn(),
}))

vi.mock('@/domain/services/template-renderer', () => ({
  renderTemplate: vi.fn(),
}))

vi.mock('@/application/resolve-campaign-members', () => ({
  resolveTargetMembers: vi.fn(),
}))

vi.mock('@/application/send-template-message', () => ({
  sendWhatsAppTemplateMessage: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository', () => ({
  findTemplateByIdForRestaurant: vi.fn(),
}))

vi.mock('@/application/check-campaign-guardrails', () => ({
  checkCampaignGuardrails: vi.fn().mockResolvedValue({
    allowed: true,
    violations: [],
    warnings: [],
  }),
}))

// WAQ-011: stub the marketing-template review gate so existing
// execute-campaign suites don't reach into the new repo paths. The gate
// has its own dedicated test file (`enforce-template-review.test.ts`).
vi.mock('@/application/enforce-template-review', () => ({
  enforceTemplateReview: vi.fn().mockResolvedValue(undefined),
}))

import { executeCampaign, NoTemplateError } from '@/application/execute-campaign'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  getCampaignById,
  incrementCampaignSent,
  updateCampaign,
  transitionCampaignStatus,
  completeCampaignRunIfCounted,
  failCampaignRunIfSending,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { findLatestCampaignFailure } from '@/infrastructure/supabase/repositories/whatsapp-message-campaign-queries'
import { findCouponsByMembersAndCampaign } from '@/infrastructure/supabase/repositories/coupon-campaign-queries'
import { findMemberIdsWithCountedSend } from '@/infrastructure/supabase/repositories/whatsapp-message-ledger-queries'
import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { emitEvent } from '@/application/emit-event'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/services/template-renderer'
import { resolveTargetMembers } from '@/application/resolve-campaign-members'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'
import { findTemplateByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import {
  insertQueued,
  attachKapsoMessageId,
  markFailedNoBspId,
} from '@/infrastructure/supabase/repositories/whatsapp-message-repository'
import {
  findActiveConsent,
  findActiveMarketingConsentForPhones,
} from '@/infrastructure/supabase/repositories/consent-record-repository'
import { countMarketingSendsLast24hForPhones } from '@/infrastructure/supabase/repositories/whatsapp-message-repository'
import { getSettingsForTenant } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import { ConsentRecord } from '@/domain/entities/consent-record'
import type { TenantCampaignSettings } from '@/domain/services/campaign-guardrails'
import { okResult, failResult } from '@/test-utils/send-result'
import { TemplateHeaderMediaMissingError } from '@/application/enforce-header-media'
import { CampaignCouponConfigMissingError } from '@/application/enforce-coupon-params'

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    restaurantId: 'r-1',
    name: 'Test Campaign',
    type: 'promo',
    template: 'Hi {{name}}, use {{code}} for {{discount}} off!',
    templateEn: null,
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 7 },
    schedule: null,
    scheduledAt: null,
    status: 'active',
    failureReason: null,
    isChargeable: true,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: null,
    targetAudience: 'all',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function buildMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm-1',
    restaurantId: 'r-1',
    phone: '85291234567',
    name: 'Alice',
    pointsBalance: 100,
    status: 'active',
    joinedAt: '2024-01-01T00:00:00Z',
    lastVisitAt: null,
    preferredLanguage: null,
    pmmThrottledUntil: null,
    unreachableAt: null,
    ...overrides,
  }
}

describe('executeCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
    vi.mocked(renderTemplate).mockReturnValue('rendered text')
    vi.mocked(generateCouponCode).mockReturnValue('CODE01')
    vi.mocked(resolveTargetMembers).mockResolvedValue([])
    // CAMP-001: the broadcaster now checks the send SendResult and throws on a
    // non-ok send (skipping mint/QR/increment/emit), so happy-path sends must
    // return a successful result by default.
    vi.mocked(sendTextMessage).mockResolvedValue(okResult('wamid.text'))
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(okResult('wamid.tpl'))
  })

  it('throws when campaign is not found', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(null)

    await expect(executeCampaign('camp-1', 'r-1'))
      .rejects.toThrow('Campaign camp-1 not found')
  })

  it('throws for welcome campaigns', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ type: 'welcome' })
    )

    await expect(executeCampaign('camp-1', 'r-1'))
      .rejects.toThrow('Welcome campaigns are triggered on member join')
  })

  it('throws when status transition fails', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(false)

    await expect(executeCampaign('camp-1', 'r-1'))
      .rejects.toThrow('not active or already processing')
  })

  it('sends messages to active members and marks completed', async () => {
    const members = [
      buildMember({ id: 'm-1', phone: '85291111111' }),
      buildMember({ id: 'm-2', phone: '85292222222' }),
    ]
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue(members)

    await executeCampaign('camp-1', 'r-1')

    expect(sendTextMessage).toHaveBeenCalledTimes(2)
    expect(createCoupon).toHaveBeenCalledTimes(2)
    expect(incrementCampaignSent).toHaveBeenCalledTimes(2)
    expect(emitEvent).toHaveBeenCalledTimes(2)
    expect(completeCampaignRunIfCounted).toHaveBeenCalledWith('camp-1')
  })

  it('filters out unsubscribed members', async () => {
    const members = [
      buildMember({ id: 'm-1', status: 'active' }),
      buildMember({ id: 'm-2', status: 'unsubscribed' }),
    ]
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue(members)

    await executeCampaign('camp-1', 'r-1')

    expect(sendTextMessage).toHaveBeenCalledTimes(1)
    expect(createCoupon).toHaveBeenCalledTimes(1)
  })

  it('creates coupon with correct discount config', async () => {
    const config: CouponConfig = {
      discountType: 'fixed_amount',
      discountValue: 50,
      expiresInDays: 14,
    }
    const campaign = buildCampaign({ couponConfig: config })
    const member = buildMember()

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue([member])

    await executeCampaign('camp-1', 'r-1')

    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'r-1',
        type: 'promo',
        code: 'CODE01',
        memberId: 'm-1',
        campaignId: 'camp-1',
        discountType: 'fixed_amount',
        discountValue: 50,
        maxUses: 1,
      })
    )
  })

  it('reverts campaign to active on failure', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockRejectedValue(
      new Error('phone lookup failed')
    )

    await expect(executeCampaign('camp-1', 'r-1'))
      .rejects.toThrow('phone lookup failed')

    expect(updateCampaign).toHaveBeenCalledWith('camp-1', { status: 'active' })
  })

  it('throws when WhatsApp template is not found — BEFORE status transition (no revert)', async () => {
    const campaign = buildCampaign({ whatsappTemplateId: 'tpl-missing' })
    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(null)

    await expect(executeCampaign('camp-1', 'r-1'))
      .rejects.toThrow('WhatsApp template tpl-missing not found')

    expect(transitionCampaignStatus).not.toHaveBeenCalled()
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('throws when WhatsApp template is not approved — BEFORE status transition (no revert)', async () => {
    const campaign = buildCampaign({ whatsappTemplateId: 'tpl-pending' })
    const pendingTemplate = {
      id: 'tpl-pending',
      restaurantId: 'r-1',
      metaTemplateId: 'meta-2',
      name: 'pending_template',
      language: 'en',
      category: 'MARKETING' as const,
      status: 'pending' as const,
      components: [],
      parameterFormat: 'NAMED' as const,
      rejectionReason: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(pendingTemplate)

    await expect(executeCampaign('camp-1', 'r-1'))
      .rejects.toThrow('WhatsApp template pending_template is not approved')

    expect(transitionCampaignStatus).not.toHaveBeenCalled()
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('processes all members across multiple batches', async () => {
    const members = Array.from({ length: 25 }, (_, i) =>
      buildMember({ id: `m-${i}`, phone: `8529${String(i).padStart(7, '0')}` })
    )
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue(members)

    await executeCampaign('camp-1', 'r-1')

    expect(sendTextMessage).toHaveBeenCalledTimes(25)
    expect(createCoupon).toHaveBeenCalledTimes(25)
    expect(incrementCampaignSent).toHaveBeenCalledTimes(25)
    expect(emitEvent).toHaveBeenCalledTimes(25)
    expect(completeCampaignRunIfCounted).toHaveBeenCalledWith('camp-1')
  })

  it('throws NoTemplateError BEFORE transitioning status — no revert needed', async () => {
    const campaign = buildCampaign({
      template: '',
      templateEn: null,
      templateZhHk: null,
      whatsappTemplateId: null,
    })
    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue([buildMember()])
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')

    await expect(executeCampaign('camp-1', 'r-1')).rejects.toBeInstanceOf(
      NoTemplateError
    )
    // The guard runs BEFORE the transition, so:
    //   - status transition must never be attempted
    //   - no revert updateCampaign call is needed
    expect(transitionCampaignStatus).not.toHaveBeenCalled()
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('picks bilingual template by restaurant default_language', async () => {
    const campaign = buildCampaign({
      template: 'LEGACY',
      templateEn: 'EN {{name}} {{code}}',
      templateZhHk: 'ZH {{name}} {{code}}',
    })
    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue([buildMember()])
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
    vi.mocked(renderTemplate).mockImplementation((tpl: string) => tpl)

    await executeCampaign('camp-1', 'r-1')

    // The resolved EN template should be what we pass to renderTemplate
    expect(renderTemplate).toHaveBeenCalledWith(
      'EN {{name}} {{code}}',
      expect.any(Object)
    )
  })

  it('per-member language overrides the restaurant default', async () => {
    // Restaurant default is zh_hk, but two members have different preferences.
    const campaign = buildCampaign({
      template: '',
      templateEn: 'EN {{name}} {{code}}',
      templateZhHk: 'ZH {{name}} {{code}}',
    })
    const enMember = buildMember({ id: 'm-en', preferredLanguage: 'en' })
    const zhMember = buildMember({ id: 'm-zh', preferredLanguage: 'zh_hk' })
    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue([enMember, zhMember])
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')
    vi.mocked(renderTemplate).mockImplementation((tpl: string) => tpl)

    await executeCampaign('camp-1', 'r-1')

    const calls = vi.mocked(renderTemplate).mock.calls
    const templates = calls.map((c) => c[0])
    expect(templates).toContain('EN {{name}} {{code}}')
    expect(templates).toContain('ZH {{name}} {{code}}')
  })

  it('member with null preferred_language falls back to restaurant default', async () => {
    const campaign = buildCampaign({
      template: '',
      templateEn: 'EN {{name}} {{code}}',
      templateZhHk: 'ZH {{name}} {{code}}',
    })
    const m = buildMember({ preferredLanguage: null })
    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue([m])
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
    vi.mocked(renderTemplate).mockImplementation((tpl: string) => tpl)

    await executeCampaign('camp-1', 'r-1')

    expect(renderTemplate).toHaveBeenCalledWith(
      'EN {{name}} {{code}}',
      expect.any(Object)
    )
  })

  it('only templateEn populated: zh_hk-preferring member falls through to EN via bilingual resolver', async () => {
    const campaign = buildCampaign({
      template: '',
      templateEn: 'EN only {{code}}',
      templateZhHk: null,
    })
    const zhMember = buildMember({ preferredLanguage: 'zh_hk' })
    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue([zhMember])
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
    vi.mocked(renderTemplate).mockImplementation((tpl: string) => tpl)

    await executeCampaign('camp-1', 'r-1')

    expect(renderTemplate).toHaveBeenCalledWith(
      'EN only {{code}}',
      expect.any(Object)
    )
  })

  it('uses WhatsApp template when whatsappTemplateId is set', async () => {
    const campaign = buildCampaign({ whatsappTemplateId: 'tpl-1' })
    const member = buildMember()
    const template = {
      id: 'tpl-1',
      restaurantId: 'r-1',
      metaTemplateId: 'meta-1',
      name: 'promo_template',
      language: 'en',
      category: 'MARKETING' as const,
      status: 'approved' as const,
      components: [],
      parameterFormat: 'NAMED' as const,
      rejectionReason: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(template)
    vi.mocked(resolveTargetMembers).mockResolvedValue([member])
    // Marketing template runs are gated by consent (WAQ-004). Grant the
    // member opt-in so the existing send path remains exercised. The batch
    // path uses the bulk repo function — return a Map keyed by phone.
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map([
        [
          member.phone,
          ConsentRecord.grant({
            id: 'cr-1',
            restaurantId: 'r-1',
            memberId: 'm-1',
            phoneE164: member.phone,
            category: 'marketing',
            source: 'pre-system migration',
            grade: 'weak',
          }),
        ],
      ])
    )

    await executeCampaign('camp-1', 'r-1')

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1)
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'phone-id-1',
        to: '85291234567',
        template,
      })
    )
  })
})

describe('executeCampaign — WAQ-004 marketing consent gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
    vi.mocked(renderTemplate).mockReturnValue('rendered text')
    vi.mocked(generateCouponCode).mockReturnValue('CODE01')
    vi.mocked(sendTextMessage).mockResolvedValue(okResult('wamid.text'))
    vi.mocked(sendImageMessage).mockResolvedValue(okResult('wamid.image'))
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(okResult('wamid.tpl'))
  })

  function buildCampaignFor(overrides: Partial<Campaign> = {}): Campaign {
    return {
      id: 'camp-1',
      restaurantId: 'r-1',
      name: 'Promo',
      type: 'promo',
      template: 'Hi {{name}}, use {{code}} for {{discount}} off!',
      templateEn: null,
      templateZhHk: null,
      imageUrlEn: null,
      imageUrlZhHk: null,
      couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 7 },
      schedule: null,
      scheduledAt: null,
      status: 'active',
      failureReason: null,
      isChargeable: true,
      chargeableSentCount: 0,
      nonChargeableSentCount: 0,
      redeemedCount: 0,
      whatsappTemplateId: null,
      targetAudience: 'all',
      createdAt: '2024-01-01T00:00:00Z',
      ...overrides,
    }
  }

  function buildMemberFor(overrides: Partial<Member> = {}): Member {
    return {
      id: 'm-1',
      restaurantId: 'r-1',
      phone: '85291234567',
      name: 'Alice',
      pointsBalance: 100,
      status: 'active',
      joinedAt: '2024-01-01T00:00:00Z',
      lastVisitAt: null,
      preferredLanguage: null,
      pmmThrottledUntil: null,
      unreachableAt: null,
      ...overrides,
    }
  }

  const marketingTemplate = {
    id: 'tpl-1',
    restaurantId: 'r-1',
    metaTemplateId: 'meta-1',
    name: 'promo_template',
    language: 'en',
    category: 'MARKETING' as const,
    status: 'approved' as const,
    components: [],
    parameterFormat: 'NAMED' as const,
    rejectionReason: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }

  it('skips members with no consent record on a MARKETING template run', async () => {
    process.env.WAQ_TRACK_MESSAGES = '1'
    const campaign = buildCampaignFor({ whatsappTemplateId: 'tpl-1' })
    const member = buildMemberFor()

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(marketingTemplate)
    vi.mocked(resolveTargetMembers).mockResolvedValue([member])
    // No consent records returned at all → bulk fetch resolves to empty Map.
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(new Map())

    await executeCampaign('camp-1', 'r-1')

    // The gate skips the WHOLE member: no body send, no QR, no DB row, no
    // counter increment, no emitted campaign event.
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
    expect(sendImageMessage).not.toHaveBeenCalled()
    expect(insertQueued).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
    // Campaign still completes — skipping is normal flow.
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', { status: 'completed' })
    // Critical: ONE bulk fetch for the batch, not one-per-member (no N+1).
    expect(findActiveMarketingConsentForPhones).toHaveBeenCalledTimes(1)
    expect(findActiveMarketingConsentForPhones).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phones: [member.phone],
    })

    delete process.env.WAQ_TRACK_MESSAGES
  })

  it('sends to members WITH consent on a MARKETING template run', async () => {
    const campaign = buildCampaignFor({ whatsappTemplateId: 'tpl-1' })
    const member = buildMemberFor()

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(marketingTemplate)
    vi.mocked(resolveTargetMembers).mockResolvedValue([member])
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map([
        [
          member.phone,
          ConsentRecord.grant({
            id: 'cr-1',
            restaurantId: 'r-1',
            memberId: 'm-1',
            phoneE164: member.phone,
            category: 'marketing',
            source: 'website_form',
            grade: 'strong',
          }),
        ],
      ])
    )

    await executeCampaign('camp-1', 'r-1')

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1)
    expect(incrementCampaignSent).toHaveBeenCalledTimes(1)
  })

  it('sends to a member partway through a batch when only one is missing consent', async () => {
    const campaign = buildCampaignFor({ whatsappTemplateId: 'tpl-1' })
    const opted = buildMemberFor({ id: 'm-1', phone: '85291111111' })
    const noConsent = buildMemberFor({ id: 'm-2', phone: '85292222222' })
    const opted2 = buildMemberFor({ id: 'm-3', phone: '85293333333' })

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(marketingTemplate)
    vi.mocked(resolveTargetMembers).mockResolvedValue([opted, noConsent, opted2])
    // Bulk fetch returns a Map with the consenting two only — `noConsent`
    // is intentionally absent, mirroring how the real query works.
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map([
        [
          opted.phone,
          ConsentRecord.grant({
            id: `cr-${opted.phone}`,
            restaurantId: 'r-1',
            memberId: null,
            phoneE164: opted.phone,
            category: 'marketing',
            source: 'website_form',
          }),
        ],
        [
          opted2.phone,
          ConsentRecord.grant({
            id: `cr-${opted2.phone}`,
            restaurantId: 'r-1',
            memberId: null,
            phoneE164: opted2.phone,
            category: 'marketing',
            source: 'website_form',
          }),
        ],
      ])
    )

    await executeCampaign('camp-1', 'r-1')

    // Only the two consenting members were sent to.
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(2)
    expect(incrementCampaignSent).toHaveBeenCalledTimes(2)
    // ONE bulk fetch for the batch — three phones, single round-trip.
    expect(findActiveMarketingConsentForPhones).toHaveBeenCalledTimes(1)
    expect(findActiveMarketingConsentForPhones).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phones: [opted.phone, noConsent.phone, opted2.phone],
    })
  })

  it('does NOT consent-check inline (non-MARKETING) campaigns — regression', async () => {
    // Inline-text campaign with no whatsappTemplateId; category is 'service'
    // and the consent gate must be skipped entirely. The bulk fetch must
    // not be called.
    const campaign = buildCampaignFor({ whatsappTemplateId: null })
    const member = buildMemberFor()

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue([member])

    await executeCampaign('camp-1', 'r-1')

    expect(findActiveConsent).not.toHaveBeenCalled()
    expect(findActiveMarketingConsentForPhones).not.toHaveBeenCalled()
    expect(sendTextMessage).toHaveBeenCalledTimes(1)
  })
})

describe('executeCampaign with WAQ_TRACK_MESSAGES=1 (per addendum §4.3)', () => {
  const ORIGINAL_FLAG = process.env.WAQ_TRACK_MESSAGES

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WAQ_TRACK_MESSAGES = '1'
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
    vi.mocked(renderTemplate).mockReturnValue('rendered text')
    vi.mocked(generateCouponCode).mockReturnValue('CODE01')
    vi.mocked(sendTextMessage).mockResolvedValue(okResult('wamid.text'))
    vi.mocked(sendImageMessage).mockResolvedValue(okResult('wamid.image'))
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(okResult('wamid.tpl'))
    vi.mocked(insertQueued).mockResolvedValue(undefined)
    vi.mocked(attachKapsoMessageId).mockResolvedValue(undefined)
    vi.mocked(markFailedNoBspId).mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.WAQ_TRACK_MESSAGES
    } else {
      process.env.WAQ_TRACK_MESSAGES = ORIGINAL_FLAG
    }
  })

  function buildCampaignLocal(overrides: Partial<Campaign> = {}): Campaign {
    return {
      id: 'camp-1',
      restaurantId: 'r-1',
      name: 'Test Campaign',
      type: 'promo',
      template: 'Hi {{name}}, use {{code}}',
      templateEn: null,
      templateZhHk: null,
      imageUrlEn: null,
      imageUrlZhHk: null,
      couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 7 },
      schedule: null,
      scheduledAt: null,
      status: 'active',
      failureReason: null,
      isChargeable: true,
      chargeableSentCount: 0,
      nonChargeableSentCount: 0,
      redeemedCount: 0,
      whatsappTemplateId: null,
      targetAudience: 'all',
      createdAt: '2024-01-01T00:00:00Z',
      ...overrides,
    }
  }

  function buildMemberLocal(overrides: Partial<Member> = {}): Member {
    return {
      id: 'm-1',
      restaurantId: 'r-1',
      phone: '85291234567',
      name: 'Alice',
      pointsBalance: 0,
      status: 'active',
      joinedAt: '2024-01-01T00:00:00Z',
      lastVisitAt: null,
      preferredLanguage: null,
      pmmThrottledUntil: null,
      unreachableAt: null,
      ...overrides,
    }
  }

  it('inserts a queued row per member (one for body, one for QR)', async () => {
    const members = [
      buildMemberLocal({ id: 'm-1', phone: '85291111111' }),
      buildMemberLocal({ id: 'm-2', phone: '85292222222' }),
    ]
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaignLocal())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue(members)

    await executeCampaign('camp-1', 'r-1')

    // 2 members × 2 rows each (body + QR) = 4 inserts
    expect(insertQueued).toHaveBeenCalledTimes(4)
    expect(attachKapsoMessageId).toHaveBeenCalledTimes(4)
  })

  it('a single member send failure does not abort the batch', async () => {
    const members = [
      buildMemberLocal({ id: 'm-1', phone: '85291111111' }),
      buildMemberLocal({ id: 'm-2', phone: '85292222222' }),
      buildMemberLocal({ id: 'm-3', phone: '85293333333' }),
    ]
    // First and third member: body sends succeed; second member's body send rejects.
    vi.mocked(sendTextMessage)
      .mockResolvedValueOnce(okResult('wamid.body-1'))
      .mockRejectedValueOnce(new Error('flaky network'))
      .mockResolvedValueOnce(okResult('wamid.body-3'))

    vi.mocked(getCampaignById).mockResolvedValue(buildCampaignLocal())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue(members)

    await executeCampaign('camp-1', 'r-1')

    // m-1 and m-3 succeed → body + QR each (4 inserts). m-2's body send
    // rejects, so under CAMP-001 AC#4 its QR is skipped (no mint/QR on a
    // failed body); only its queued body row inserts → 5 total.
    expect(insertQueued).toHaveBeenCalledTimes(5)
    // Failed body for m-2 went through markFailedNoBspId
    expect(markFailedNoBspId).toHaveBeenCalled()
    // Status still flips to completed because the batch tolerates failures
    expect(completeCampaignRunIfCounted).toHaveBeenCalledWith('camp-1')
  })
})

describe('executeCampaign — WAQ-007 per-user marketing cooldown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
    vi.mocked(renderTemplate).mockReturnValue('rendered text')
    vi.mocked(generateCouponCode).mockReturnValue('CODE01')
    vi.mocked(sendTextMessage).mockResolvedValue(okResult('wamid.text'))
    vi.mocked(sendImageMessage).mockResolvedValue(okResult('wamid.image'))
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(okResult('wamid.tpl'))
    // Default: cooldown counter empty (no prior sends).
    vi.mocked(countMarketingSendsLast24hForPhones).mockResolvedValue(new Map())
  })

  function buildCampaignFor(overrides: Partial<Campaign> = {}): Campaign {
    return {
      id: 'camp-1',
      restaurantId: 'r-1',
      name: 'Promo',
      type: 'promo',
      template: 'Hi {{name}}',
      templateEn: null,
      templateZhHk: null,
      imageUrlEn: null,
      imageUrlZhHk: null,
      couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 7 },
      schedule: null,
      scheduledAt: null,
      status: 'active',
      failureReason: null,
      isChargeable: true,
      chargeableSentCount: 0,
      nonChargeableSentCount: 0,
      redeemedCount: 0,
      whatsappTemplateId: null,
      targetAudience: 'all',
      createdAt: '2024-01-01T00:00:00Z',
      ...overrides,
    }
  }

  function buildMemberFor(overrides: Partial<Member> = {}): Member {
    return {
      id: 'm-1',
      restaurantId: 'r-1',
      phone: '85291234567',
      name: 'Alice',
      pointsBalance: 100,
      status: 'active',
      joinedAt: '2024-01-01T00:00:00Z',
      lastVisitAt: null,
      preferredLanguage: null,
      pmmThrottledUntil: null,
      unreachableAt: null,
      ...overrides,
    }
  }

  const marketingTemplate = {
    id: 'tpl-1',
    restaurantId: 'r-1',
    metaTemplateId: 'meta-1',
    name: 'promo_template',
    language: 'en',
    category: 'MARKETING' as const,
    status: 'approved' as const,
    components: [],
    parameterFormat: 'NAMED' as const,
    rejectionReason: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }

  function grantConsent(phone: string): ConsentRecord {
    return ConsentRecord.grant({
      id: `cr-${phone}`,
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: phone,
      category: 'marketing',
      source: 'website_form',
    })
  }

  function consentMapFor(phones: string[]): Map<string, ConsentRecord> {
    return new Map(phones.map((p) => [p, grantConsent(p)]))
  }

  it('skips a member whose pmm_throttled_until is in the future', async () => {
    const campaign = buildCampaignFor({ whatsappTemplateId: 'tpl-1' })
    const future = new Date(Date.now() + 3600_000).toISOString()
    const throttled = buildMemberFor({ pmmThrottledUntil: future })

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(marketingTemplate)
    vi.mocked(resolveTargetMembers).mockResolvedValue([throttled])
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      consentMapFor([throttled.phone])
    )

    await executeCampaign('camp-1', 'r-1')

    // Skip is total: no template send, no coupon, no counter, no event.
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
    expect(insertQueued).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', { status: 'completed' })
  })

  it('skips a member whose 24h marketing-send count meets the default cap of 1', async () => {
    const campaign = buildCampaignFor({ whatsappTemplateId: 'tpl-1' })
    const m = buildMemberFor()

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(marketingTemplate)
    vi.mocked(resolveTargetMembers).mockResolvedValue([m])
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      consentMapFor([m.phone])
    )
    // Already 1 successful marketing send in the last 24h → cap_exceeded.
    vi.mocked(countMarketingSendsLast24hForPhones).mockResolvedValue(
      new Map([[m.phone, 1]])
    )

    await executeCampaign('camp-1', 'r-1')

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
  })

  it('skips a member who is marked unreachable (131026 set unreachable_at)', async () => {
    const campaign = buildCampaignFor({ whatsappTemplateId: 'tpl-1' })
    const dead = buildMemberFor({ unreachableAt: '2026-01-01T00:00:00Z' })

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(marketingTemplate)
    vi.mocked(resolveTargetMembers).mockResolvedValue([dead])
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      consentMapFor([dead.phone])
    )

    await executeCampaign('camp-1', 'r-1')

    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
    expect(incrementCampaignSent).not.toHaveBeenCalled()
  })

  it('cap=2 (tenant override) allows a second send to the same recipient within 24h', async () => {
    const campaign = buildCampaignFor({ whatsappTemplateId: 'tpl-1' })
    const m = buildMemberFor()

    // Tenant overrides per_user_marketing_cap to 2.
    const settings: TenantCampaignSettings = {
      restaurantId: 'r-1',
      monthlySendLimit: 1000,
      dailyCampaignLimit: 1,
      maxUnsubscribeRate: 0.05,
      campaignPaused: false,
      perUserMarketingCap: 2,
      autoThrottleFactor: 1,
      autoPauseActive: false,
      autoPauseReason: null,
      autoPauseSetAt: null,
      pacingStrategy: 'engagement_tier',
      probeChunkSize: 100,
      scaleChunkSize: 100,
      activeHoursStartLocal: '10:00:00',
      activeHoursEndLocal: '22:00:00',
      tenantTimezone: 'Asia/Hong_Kong',
    }
    vi.mocked(getSettingsForTenant).mockResolvedValue(settings)

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(marketingTemplate)
    vi.mocked(resolveTargetMembers).mockResolvedValue([m])
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      consentMapFor([m.phone])
    )
    // Same recipient counted as 1 — second send within 24h still allowed
    // because the tenant has opted into a higher cap.
    vi.mocked(countMarketingSendsLast24hForPhones).mockResolvedValue(
      new Map([[m.phone, 1]])
    )

    await executeCampaign('camp-1', 'r-1')

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1)
    expect(incrementCampaignSent).toHaveBeenCalledTimes(1)

    // Restore default for downstream tests.
    vi.mocked(getSettingsForTenant).mockResolvedValue(null)
  })

  it('does NOT call the cooldown counter for non-MARKETING (inline) campaigns — regression', async () => {
    const campaign = buildCampaignFor({ whatsappTemplateId: null })
    const m = buildMemberFor()

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue([m])

    await executeCampaign('camp-1', 'r-1')

    // The cooldown counter is gated behind isMarketingRun(); inline runs
    // bypass it entirely so PMM-budget tracking isn't billed for receipt /
    // operational sends.
    expect(countMarketingSendsLast24hForPhones).not.toHaveBeenCalled()
    expect(findActiveMarketingConsentForPhones).not.toHaveBeenCalled()
    expect(sendTextMessage).toHaveBeenCalledTimes(1)
  })
})

describe('executeCampaign — WAQ-010 engagement-tier pacing', () => {
  const ORIGINAL_DELAY = process.env.WAQ_BATCH_DELAY_MS

  beforeEach(() => {
    vi.clearAllMocks()
    // Tests run with delay = 0 so probe → scale waits do not slow the suite.
    process.env.WAQ_BATCH_DELAY_MS = '0'
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
    vi.mocked(renderTemplate).mockReturnValue('rendered text')
    vi.mocked(generateCouponCode).mockReturnValue('CODE01')
    vi.mocked(sendTextMessage).mockResolvedValue(okResult('wamid.text'))
    vi.mocked(sendImageMessage).mockResolvedValue(okResult('wamid.image'))
    vi.mocked(getSettingsForTenant).mockResolvedValue(null)
  })

  afterEach(() => {
    if (ORIGINAL_DELAY === undefined) {
      delete process.env.WAQ_BATCH_DELAY_MS
    } else {
      process.env.WAQ_BATCH_DELAY_MS = ORIGINAL_DELAY
    }
  })

  function buildPacingSettings(
    overrides: Partial<TenantCampaignSettings> = {}
  ): TenantCampaignSettings {
    return {
      restaurantId: 'r-1',
      monthlySendLimit: 10000,
      dailyCampaignLimit: 100,
      maxUnsubscribeRate: 0.05,
      campaignPaused: false,
      perUserMarketingCap: 1,
      autoThrottleFactor: 1,
      autoPauseActive: false,
      autoPauseReason: null,
      autoPauseSetAt: null,
      pacingStrategy: 'engagement_tier',
      probeChunkSize: 100,
      scaleChunkSize: 100,
      activeHoursStartLocal: '10:00:00',
      activeHoursEndLocal: '22:00:00',
      tenantTimezone: 'Asia/Hong_Kong',
      ...overrides,
    }
  }

  function buildCampaignFor(overrides: Partial<Campaign> = {}): Campaign {
    return {
      id: 'camp-1',
      restaurantId: 'r-1',
      name: 'Promo',
      type: 'promo',
      template: 'Hi {{name}}',
      templateEn: null,
      templateZhHk: null,
      imageUrlEn: null,
      imageUrlZhHk: null,
      couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 7 },
      schedule: null,
      scheduledAt: null,
      status: 'active',
      failureReason: null,
      isChargeable: true,
      chargeableSentCount: 0,
      nonChargeableSentCount: 0,
      redeemedCount: 0,
      whatsappTemplateId: null,
      targetAudience: 'all',
      createdAt: '2024-01-01T00:00:00Z',
      ...overrides,
    }
  }

  function buildMemberFor(overrides: Partial<Member> = {}): Member {
    return {
      id: 'm-1',
      restaurantId: 'r-1',
      phone: '85291234567',
      name: 'Alice',
      pointsBalance: 100,
      status: 'active',
      joinedAt: '2024-01-01T00:00:00Z',
      lastVisitAt: null,
      preferredLanguage: null,
      pmmThrottledUntil: null,
      unreachableAt: null,
      ...overrides,
    }
  }

  it('engagement_tier sorts recipients by lastVisitAt DESC before sending', async () => {
    // Three recipients in REVERSE engagement order (oldest first). The
    // batch loop should reorder them so the most-recent visitor goes first.
    const oldest = buildMemberFor({
      id: 'old',
      phone: '85290000001',
      lastVisitAt: '2026-01-01T00:00:00Z',
    })
    const newest = buildMemberFor({
      id: 'new',
      phone: '85290000002',
      lastVisitAt: '2026-05-01T00:00:00Z',
    })
    const middle = buildMemberFor({
      id: 'mid',
      phone: '85290000003',
      lastVisitAt: '2026-03-01T00:00:00Z',
    })

    vi.mocked(getCampaignById).mockResolvedValue(buildCampaignFor())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue([oldest, newest, middle])

    await executeCampaign('camp-1', 'r-1')

    // sendTextMessage is called once per recipient; the FIRST call must be
    // the most-recent visitor — proves the sort happened before chunking.
    // Signature is (phoneNumberId, to, text) — `to` is the second arg.
    const calls = vi.mocked(sendTextMessage).mock.calls
    expect(calls.length).toBe(3)
    expect(calls[0][1]).toBe('85290000002')
    expect(calls[1][1]).toBe('85290000003')
    expect(calls[2][1]).toBe('85290000001')
  })

  it('naive strategy preserves insertion order (no engagement sort)', async () => {
    vi.mocked(getSettingsForTenant).mockResolvedValue(
      buildPacingSettings({ pacingStrategy: 'naive' })
    )
    const oldest = buildMemberFor({
      id: 'old',
      phone: '85290000001',
      lastVisitAt: '2026-01-01T00:00:00Z',
    })
    const newest = buildMemberFor({
      id: 'new',
      phone: '85290000002',
      lastVisitAt: '2026-05-01T00:00:00Z',
    })

    vi.mocked(getCampaignById).mockResolvedValue(buildCampaignFor())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    // Insertion order is oldest THEN newest; naive must keep this exact order.
    vi.mocked(resolveTargetMembers).mockResolvedValue([oldest, newest])

    await executeCampaign('camp-1', 'r-1')

    const calls = vi.mocked(sendTextMessage).mock.calls
    expect(calls[0][1]).toBe('85290000001')
    expect(calls[1][1]).toBe('85290000002')
  })

  it('honors probeChunkSize for the FIRST chunk and scaleChunkSize for the rest', async () => {
    // probe=2, scale=3 → 6 recipients should split as [2, 3, 1]. We assert
    // by counting the unique chunk-boundary log lines (probe boundary fires
    // exactly once, scale boundary fires once per scale chunk after the first).
    vi.mocked(getSettingsForTenant).mockResolvedValue(
      buildPacingSettings({ probeChunkSize: 2, scaleChunkSize: 3 })
    )
    const members = Array.from({ length: 6 }, (_, i) =>
      buildMemberFor({
        id: `m-${i}`,
        phone: `8529000000${i}`,
        lastVisitAt: `2026-05-0${i + 1}T00:00:00Z`,
      })
    )

    vi.mocked(getCampaignById).mockResolvedValue(buildCampaignFor())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue(members)

    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await executeCampaign('camp-1', 'r-1')

    // All 6 sent.
    expect(sendTextMessage).toHaveBeenCalledTimes(6)
    // Probe-boundary log fires once with the probe chunk-size in payload.
    const probeLogs = logSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('campaign.probe_chunk_complete')
    )
    expect(probeLogs.length).toBe(1)
    // The probe payload should mention probeSize:2 — proves the chunker used
    // the configured probe size, not the legacy BATCH_SIZE constant.
    const payload = probeLogs[0][1] as Record<string, unknown> | undefined
    expect(payload).toMatchObject({ probeSize: 2 })

    logSpy.mockRestore()
  })

  it('probe-boundary log includes a KPI snapshot from whatsapp_messages', async () => {
    // Phase 1 only LOGS the snapshot — no auto-abort yet. The snapshot keys
    // must be present so ops can wire alerts off the structured log line.
    vi.mocked(getSettingsForTenant).mockResolvedValue(
      buildPacingSettings({ probeChunkSize: 2, scaleChunkSize: 100 })
    )
    const members = Array.from({ length: 3 }, (_, i) =>
      buildMemberFor({ id: `m-${i}`, phone: `8529000000${i}` })
    )

    vi.mocked(getCampaignById).mockResolvedValue(buildCampaignFor())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue(members)

    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await executeCampaign('camp-1', 'r-1')

    const probeLog = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('campaign.probe_chunk_complete')
    )
    expect(probeLog).toBeDefined()
    const payload = probeLog?.[1] as Record<string, unknown>
    // KPI snapshot keys exist even when the values are 0 (no errors yet).
    expect(payload).toHaveProperty('campaignId', 'camp-1')
    expect(payload).toHaveProperty('probeSize')
    expect(payload).toHaveProperty('sent')
    expect(payload).toHaveProperty('skipped')

    logSpy.mockRestore()
  })

  it('does NOT emit a probe-boundary log when there is only one chunk (probe == total)', async () => {
    // 2 recipients, probe=100 → only one chunk, no probe→scale boundary
    // happens. Suppress the log to avoid noise on small campaigns.
    vi.mocked(getSettingsForTenant).mockResolvedValue(
      buildPacingSettings({ probeChunkSize: 100, scaleChunkSize: 100 })
    )
    const members = [
      buildMemberFor({ id: 'm-1', phone: '85290000001' }),
      buildMemberFor({ id: 'm-2', phone: '85290000002' }),
    ]
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaignFor())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue(members)

    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await executeCampaign('camp-1', 'r-1')

    const probeLogs = logSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('campaign.probe_chunk_complete')
    )
    expect(probeLogs.length).toBe(0)

    logSpy.mockRestore()
  })

  it('probe-boundary log preserves sent+skipped+failed === probeSize when a send fails', async () => {
    // Tracking OFF for this case: with tracking on, recordOutboundSend turns
    // a transport throw into a recorded `failed` row (BSP-rejected), which is
    // a different, already-covered tally. This test pins the raw-throw path.
    process.env.WAQ_TRACK_MESSAGES = '0'
    // Review fix (gemini r1 + analyzer IMPORTANT): `failed` was previously
    // double-counted — once inside `skipped` and again as its own field.
    // Phase 2 KPI thresholds (delivery >=95%, error <0.5%) read these
    // fields directly, so the invariant must hold.
    vi.mocked(getSettingsForTenant).mockResolvedValue(
      buildPacingSettings({ probeChunkSize: 3, scaleChunkSize: 3 })
    )
    const probeMembers = [
      buildMemberFor({ id: 'p-0', phone: '85290000010' }),
      buildMemberFor({ id: 'p-1', phone: '85290000011' }),
      buildMemberFor({ id: 'p-2', phone: '85290000012' }),
    ]
    const scaleMembers = [
      buildMemberFor({ id: 's-0', phone: '85290000020' }),
    ]
    // First two probe sends succeed; third probe send rejects → counters.failed=1.
    // Subsequent scale calls succeed (we only assert the probe boundary log).
    vi.mocked(sendTextMessage)
      .mockResolvedValueOnce(okResult('wamid.text'))
      .mockResolvedValueOnce(okResult('wamid.text'))
      .mockRejectedValueOnce(new Error('flaky network'))
      .mockResolvedValue(okResult('wamid.text'))

    vi.mocked(getCampaignById).mockResolvedValue(buildCampaignFor())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue([
      ...probeMembers,
      ...scaleMembers,
    ])
    // Suppress the expected error log from the rejected send.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await executeCampaign('camp-1', 'r-1')

    const probeLog = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('campaign.probe_chunk_complete')
    )
    expect(probeLog).toBeDefined()
    const payload = probeLog?.[1] as {
      probeSize: number
      sent: number
      skipped: number
      failed: number
      errored: number
    }
    // #127: a raw transport throw is `errored` (delivery unknown), not
    // `failed` (BSP rejected) — and neither may be double-counted in skipped.
    expect(payload.failed).toBe(0)
    expect(payload.errored).toBe(1)
    expect(payload.skipped).toBe(0)
    expect(payload.sent).toBe(2)
    // The invariant Phase 2 KPI consumers depend on.
    expect(
      payload.sent + payload.skipped + payload.failed + payload.errored
    ).toBe(payload.probeSize)
    expect(payload.probeSize).toBe(3)

    logSpy.mockRestore()
    errSpy.mockRestore()
    delete process.env.WAQ_TRACK_MESSAGES
  })

  it('caps in-flight sendTextMessage concurrency at 20 even within a 100-member chunk', async () => {
    // Review fix (gemini r1 CRITICAL): chunk sizes can now reach 1000 (per
    // migration 043). Without an inner sub-batch ceiling, each chunk would
    // launch up to 1000 parallel BSP sends + DB writes — Supabase pool
    // exhaustion. The legacy BATCH_SIZE=20 provided implicit throttling;
    // we re-establish it as an explicit CONCURRENCY_LIMIT.
    vi.mocked(getSettingsForTenant).mockResolvedValue(
      buildPacingSettings({ probeChunkSize: 100, scaleChunkSize: 100 })
    )

    const members = Array.from({ length: 100 }, (_, i) =>
      buildMemberFor({
        id: `m-${i}`,
        // Pad to 11 digits so all phones are unique without leading-zero
        // collisions (`8529000000${i}` would dedupe phones for i=0..9 vs 10).
        phone: `852910${String(i).padStart(5, '0')}`,
      })
    )

    let inFlight = 0
    let peakInFlight = 0
    vi.mocked(sendTextMessage).mockImplementation(async () => {
      inFlight++
      if (inFlight > peakInFlight) peakInFlight = inFlight
      // Yield so all started sends overlap in the event loop. setImmediate
      // releases the microtask queue first, giving Promise.allSettled a
      // chance to start every parallel call before any of them resolve.
      await new Promise<void>((resolve) => setImmediate(resolve))
      inFlight--
      return okResult('wamid.text')
    })

    vi.mocked(getCampaignById).mockResolvedValue(buildCampaignFor())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(resolveTargetMembers).mockResolvedValue(members)

    await executeCampaign('camp-1', 'r-1')

    expect(sendTextMessage).toHaveBeenCalledTimes(100)
    // Peak concurrency must never exceed the inner sub-batch ceiling.
    expect(peakInFlight).toBeLessThanOrEqual(20)
    // Sanity: we should still be running in PARALLEL within a sub-batch
    // (i.e. not serialised). With 20 concurrent slots and 100 members the
    // peak should land at the ceiling, not at 1.
    expect(peakInFlight).toBeGreaterThan(1)
  })
})

// #127 / CAMP-007: an all-failed run must never read `completed` (the prod
// incident: 2/2 sends rejected by Meta with #132012 yet the dashboard showed
// the campaign as completed with 0 sent and no failure_reason), and a
// template that declares a media header we cannot supply must fail fast
// before any member send is burned.
describe('executeCampaign — #127 all-failed runs and media-header guard (CAMP-007)', () => {
  const utilityTemplate = {
    id: 'tpl-u',
    restaurantId: 'r-1',
    metaTemplateId: 'meta-9',
    name: 'no_vars_template',
    language: 'en',
    category: 'UTILITY' as const,
    status: 'approved' as const,
    components: [{ type: 'BODY' as const, text: 'Hello!' }],
    parameterFormat: 'NAMED' as const,
    rejectionReason: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateCouponCode).mockReturnValue('CODE01')
    vi.mocked(renderTemplate).mockReturnValue('rendered text')
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(sendTextMessage).mockResolvedValue(okResult('wamid.text'))
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(okResult('wamid.tpl'))
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ whatsappTemplateId: 'tpl-u' })
    )
    vi.mocked(completeCampaignRunIfCounted).mockResolvedValue(true)
    vi.mocked(failCampaignRunIfSending).mockResolvedValue(true)
    vi.mocked(findLatestCampaignFailure).mockResolvedValue(null)
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(utilityTemplate)
    vi.mocked(resolveTargetMembers).mockResolvedValue([
      buildMember({ id: 'm-1', phone: '85291111111' }),
      buildMember({ id: 'm-2', phone: '85292222222' }),
    ])
  })

  it('marks the campaign failed with a tenant-visible reason when every send fails', async () => {
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(
      failResult('kapso_send_error')
    )

    await executeCampaign('camp-1', 'r-1')

    expect(updateCampaign).toHaveBeenCalledWith('camp-1', {
      status: 'failed',
      failureReason: expect.stringContaining('All 2'),
    })
    expect(updateCampaign).not.toHaveBeenCalledWith('camp-1', {
      status: 'completed',
    })
    // Terminal write, not a revert: the row must never bounce back to
    // 'active' (which would re-enter the cron's due filter and burn
    // blind retries) nor stay stuck in 'sending'.
    expect(updateCampaign).not.toHaveBeenCalledWith('camp-1', {
      status: 'active',
    })
  })

  it('completes a run with zero target members (nothing failed, nothing sent)', async () => {
    vi.mocked(resolveTargetMembers).mockResolvedValue([])

    await executeCampaign('camp-1', 'r-1')

    expect(updateCampaign).toHaveBeenCalledWith('camp-1', {
      status: 'completed',
    })
  })

  // #131: a synchronous ack is not delivery. When Meta's rejection webhooks
  // retract every counted send before the finaliser runs, the CAS loses and
  // the run must end `failed` with the Meta reason — never `completed`.
  it('marks the run failed with the Meta reason when every counted send was retracted before finalize', async () => {
    vi.mocked(completeCampaignRunIfCounted).mockResolvedValue(false)
    vi.mocked(findLatestCampaignFailure).mockResolvedValue({
      errorCode: '131042',
      errorTitle: 'Business eligibility payment issue',
    })

    await executeCampaign('camp-1', 'r-1')

    expect(completeCampaignRunIfCounted).toHaveBeenCalledWith('camp-1')
    expect(findLatestCampaignFailure).toHaveBeenCalledWith('camp-1', 'r-1')
    expect(failCampaignRunIfSending).toHaveBeenCalledWith(
      'camp-1',
      expect.stringContaining('131042')
    )
    expect(updateCampaign).not.toHaveBeenCalledWith('camp-1', {
      status: 'completed',
    })
  })

  it('interleaving: a retraction landing between the batch and finalize still ends failed, never completed', async () => {
    // Simulate the webhook zeroing the counters while sendInBatches is still
    // running: the CAS observes the drained counters and refuses.
    vi.mocked(sendWhatsAppTemplateMessage).mockImplementation(async () => {
      vi.mocked(completeCampaignRunIfCounted).mockResolvedValue(false)
      return okResult('wamid.tpl')
    })
    vi.mocked(findLatestCampaignFailure).mockResolvedValue({
      errorCode: '131047',
      errorTitle: 'Re-engagement message',
    })

    await executeCampaign('camp-1', 'r-1')

    expect(incrementCampaignSent).toHaveBeenCalledTimes(2)
    expect(updateCampaign).not.toHaveBeenCalledWith('camp-1', { status: 'completed' })
    expect(failCampaignRunIfSending).toHaveBeenCalledTimes(1)
    const [, reason] = vi.mocked(failCampaignRunIfSending).mock.calls[0]
    expect(reason).toContain('Meta')
    expect(reason).toContain('131047')
    expect(reason).toContain('not an OhMyClient')
  })

  // #131 review (Important 1): a lost CAS with NO rejected body row on record
  // (tenant paused the run, transient state) must not be reported to the
  // tenant as a Meta rejection — name only the system that decided.
  it('never asserts a Meta rejection when the CAS lost but no failed body row exists', async () => {
    vi.mocked(completeCampaignRunIfCounted).mockResolvedValue(false)
    vi.mocked(findLatestCampaignFailure).mockResolvedValue(null)

    await executeCampaign('camp-1', 'r-1')

    expect(failCampaignRunIfSending).toHaveBeenCalledTimes(1)
    const [, reason] = vi.mocked(failCampaignRunIfSending).mock.calls[0]
    expect(reason).not.toMatch(/Meta/)
    expect(reason).toContain('No sent message remained counted')
  })

  it('leaves a status the tenant changed mid-run alone (scoped failure write returns false)', async () => {
    vi.mocked(completeCampaignRunIfCounted).mockResolvedValue(false)
    vi.mocked(failCampaignRunIfSending).mockResolvedValue(false)

    await expect(executeCampaign('camp-1', 'r-1')).resolves.toBeUndefined()

    // No unscoped write that could overwrite a paused / PATCHed status.
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('does not consult the CAS when nothing was attempted (all skipped)', async () => {
    vi.mocked(resolveTargetMembers).mockResolvedValue([])

    await executeCampaign('camp-1', 'r-1')

    expect(completeCampaignRunIfCounted).not.toHaveBeenCalled()
  })

  it('does not leak raw send-error internals into the failure reason', async () => {
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(
      failResult('kapso_send_error')
    )

    await executeCampaign('camp-1', 'r-1')

    const failedCall = vi
      .mocked(updateCampaign)
      .mock.calls.find(([, changes]) => changes.status === 'failed')
    expect(failedCall).toBeDefined()
    expect(failedCall![1].failureReason).not.toContain('kapso')
  })

  it('still completes when only some sends fail', async () => {
    vi.mocked(sendWhatsAppTemplateMessage)
      .mockResolvedValueOnce(failResult('kapso_send_error'))
      .mockResolvedValue(okResult('wamid.tpl'))

    await executeCampaign('camp-1', 'r-1')

    expect(completeCampaignRunIfCounted).toHaveBeenCalledWith('camp-1')
  })

  it('fails fast BEFORE the status transition when the template needs a media header with no stored URL', async () => {
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
      ...utilityTemplate,
      name: 'fifth_anniversary',
      components: [
        {
          type: 'HEADER' as const,
          format: 'IMAGE' as const,
          example: { header_handle: ['4:aBcDeF=='] },
        },
        { type: 'BODY' as const, text: 'Hello!' },
      ],
    })

    await expect(executeCampaign('camp-1', 'r-1')).rejects.toBeInstanceOf(
      TemplateHeaderMediaMissingError
    )

    expect(transitionCampaignStatus).not.toHaveBeenCalled()
    expect(updateCampaign).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  // I-1 / #134: a scheduled (cron) run must fail fast the same way — before
  // any member send is burned — when the campaign has no coupon config but
  // its template still expects a code ({{code}} body variable here).
  it('fails fast BEFORE the status transition when the campaign has no coupon config but the template expects a code', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ whatsappTemplateId: 'tpl-u', couponConfig: null })
    )
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
      ...utilityTemplate,
      name: 'free_drink',
      components: [{ type: 'BODY' as const, text: 'Hi {{name}}, code {{code}}' }],
    })

    await expect(executeCampaign('camp-1', 'r-1')).rejects.toBeInstanceOf(
      CampaignCouponConfigMissingError
    )

    expect(transitionCampaignStatus).not.toHaveBeenCalled()
    expect(updateCampaign).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
  })

  // Red-team pin (#127): a DELIVERED run whose post-send bookkeeping broke
  // must never claim "all sends failed" — that wording invites a revival
  // that would re-send to every member. Delivery is unknown, say so.
  it('does not claim all-sends-failed when sends delivered but bookkeeping broke', async () => {
    vi.mocked(incrementCampaignSent).mockRejectedValue(
      new Error('increment_chargeable_sent RPC missing')
    )

    await executeCampaign('camp-1', 'r-1')

    const failedCall = vi
      .mocked(updateCampaign)
      .mock.calls.find(([, changes]) => changes.status === 'failed')
    expect(failedCall).toBeDefined()
    expect(failedCall![1].failureReason).toContain('could not be confirmed')
    expect(failedCall![1].failureReason).not.toContain('All')
  })

  it('still completes when one member delivered fully and another broke post-send', async () => {
    vi.mocked(incrementCampaignSent)
      .mockRejectedValueOnce(new Error('transient RPC blip'))
      .mockResolvedValue(undefined)

    await executeCampaign('camp-1', 'r-1')

    expect(completeCampaignRunIfCounted).toHaveBeenCalledWith('camp-1')
  })

  // Red-team pin (#127): the failure reason must name the deciding system —
  // an inline text campaign has no WhatsApp template to blame.
  it('blames the WhatsApp connection, not a template, when an inline campaign all-fails', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ whatsappTemplateId: null })
    )
    vi.mocked(sendTextMessage).mockResolvedValue(
      failResult('kapso_no_phone_number_id')
    )

    await executeCampaign('camp-1', 'r-1')

    const failedCall = vi
      .mocked(updateCampaign)
      .mock.calls.find(([, changes]) => changes.status === 'failed')
    expect(failedCall).toBeDefined()
    expect(failedCall![1].failureReason).toContain('WhatsApp is connected')
    expect(failedCall![1].failureReason).not.toContain('approved definition')
  })

  // Boundary pin: skips must NOT rescue a run whose every ATTEMPTED send
  // failed — allFailed is (failed > 0 && sent === 0), and gate skips count
  // toward neither side.
  it('marks failed when the only attempted send fails even though others were skipped', async () => {
    const marketingTemplate = {
      ...utilityTemplate,
      id: 'tpl-m',
      name: 'promo_template',
      category: 'MARKETING' as const,
    }
    const consented = buildMember({ id: 'm-1', phone: '85291111111' })
    const noConsent1 = buildMember({ id: 'm-2', phone: '85292222222' })
    const noConsent2 = buildMember({ id: 'm-3', phone: '85293333333' })
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ whatsappTemplateId: 'tpl-m' })
    )
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(marketingTemplate)
    vi.mocked(resolveTargetMembers).mockResolvedValue([
      consented,
      noConsent1,
      noConsent2,
    ])
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map([
        [
          consented.phone,
          ConsentRecord.grant({
            id: 'cr-1',
            restaurantId: 'r-1',
            memberId: 'm-1',
            phoneE164: consented.phone,
            category: 'marketing',
            source: 'website_form',
            grade: 'strong',
          }),
        ],
      ])
    )
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(
      failResult('kapso_send_error')
    )

    await executeCampaign('camp-1', 'r-1')

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(1)
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', {
      status: 'failed',
      failureReason: expect.stringContaining('All 1'),
    })
  })

  it('proceeds normally when the media header holds a stored https URL', async () => {
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
      ...utilityTemplate,
      components: [
        {
          type: 'HEADER' as const,
          format: 'IMAGE' as const,
          example: { header_handle: ['https://cdn.example.com/pic.jpg'] },
        },
        { type: 'BODY' as const, text: 'Hello!' },
      ],
    })

    await executeCampaign('camp-1', 'r-1')

    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledTimes(2)
    expect(completeCampaignRunIfCounted).toHaveBeenCalledWith('camp-1')
  })
})

// #131 §4 / CAMP-002: re-executing a campaign reaches ONLY the members whose
// first send was rejected. Members with a counted (non-failed) body row are
// skipped — never re-sent, never re-counted — via one ledger query per chunk.
describe('executeCampaign — re-run ledger (#131 / CAMP-002)', () => {
  const ORIGINAL_FLAG = process.env.WAQ_TRACK_MESSAGES

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.WAQ_TRACK_MESSAGES
    vi.mocked(generateCouponCode).mockReturnValue('CODE01')
    vi.mocked(renderTemplate).mockReturnValue('rendered text')
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(sendTextMessage).mockResolvedValue(okResult('wamid.text'))
    vi.mocked(sendImageMessage).mockResolvedValue(okResult('wamid.img'))
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign())
    vi.mocked(completeCampaignRunIfCounted).mockResolvedValue(true)
    vi.mocked(failCampaignRunIfSending).mockResolvedValue(true)
    vi.mocked(findCouponsByMembersAndCampaign).mockResolvedValue(new Map())
    vi.mocked(findMemberIdsWithCountedSend).mockResolvedValue(new Set())
    vi.mocked(resolveTargetMembers).mockResolvedValue([
      buildMember({ id: 'm-1', phone: '85291111111' }),
      buildMember({ id: 'm-2', phone: '85292222222' }),
    ])
  })

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.WAQ_TRACK_MESSAGES
    else process.env.WAQ_TRACK_MESSAGES = ORIGINAL_FLAG
  })

  it('skips members with a counted prior send and re-sends only the rejected ones', async () => {
    vi.mocked(findMemberIdsWithCountedSend).mockResolvedValue(new Set(['m-1']))

    await executeCampaign('camp-1', 'r-1')

    expect(findMemberIdsWithCountedSend).toHaveBeenCalledTimes(1)
    expect(findMemberIdsWithCountedSend).toHaveBeenCalledWith({
      campaignId: 'camp-1',
      restaurantId: 'r-1',
      memberIds: ['m-1', 'm-2'],
    })
    expect(sendTextMessage).toHaveBeenCalledTimes(1)
    expect(sendTextMessage).toHaveBeenCalledWith('phone-id-1', '85292222222', expect.any(String))
    expect(incrementCampaignSent).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledTimes(1)
    expect(completeCampaignRunIfCounted).toHaveBeenCalledWith('camp-1')
  })

  it('completes (not failed) when every member was already reached', async () => {
    vi.mocked(findMemberIdsWithCountedSend).mockResolvedValue(new Set(['m-1', 'm-2']))

    await executeCampaign('camp-1', 'r-1')

    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', { status: 'completed' })
    expect(completeCampaignRunIfCounted).not.toHaveBeenCalled()
  })

  it('reuses each member\'s existing coupon code on the re-run body', async () => {
    vi.mocked(findCouponsByMembersAndCampaign).mockResolvedValue(
      new Map([
        [
          'm-2',
          {
            id: 'c-2', restaurantId: 'r-1', type: 'promo', code: 'KEPT01', status: 'active',
            memberId: 'm-2', expiresAt: null, redeemedAt: null, discountType: 'percentage',
            discountValue: 10, maxUses: 1, currentUses: 0, isActive: true, isChargeable: true,
            title: null, description: null, campaignId: 'camp-1', createdAt: '2026-08-26T00:00:00Z',
          },
        ],
      ])
    )
    vi.mocked(findMemberIdsWithCountedSend).mockResolvedValue(new Set(['m-1']))

    await executeCampaign('camp-1', 'r-1')

    expect(createCoupon).not.toHaveBeenCalled()
    expect(renderTemplate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: 'KEPT01' })
    )
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ dataJson: { campaignId: 'camp-1', couponCode: 'KEPT01' } })
    )
  })

  it('does not consult the ledger when tracking is off (pre-#131 behaviour)', async () => {
    process.env.WAQ_TRACK_MESSAGES = '0'

    await executeCampaign('camp-1', 'r-1')

    expect(findMemberIdsWithCountedSend).not.toHaveBeenCalled()
    expect(sendTextMessage).toHaveBeenCalledTimes(2)
  })
})
