import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Campaign, CouponConfig } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'

vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getCampaignById: vi.fn(),
  incrementCampaignSent: vi.fn(),
  updateCampaign: vi.fn(),
  transitionCampaignStatus: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  createCoupon: vi.fn(),
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
  findTemplateById: vi.fn(),
}))

vi.mock('@/application/check-campaign-guardrails', () => ({
  checkCampaignGuardrails: vi.fn().mockResolvedValue({
    allowed: true,
    violations: [],
    warnings: [],
  }),
}))

import { executeCampaign, NoTemplateError } from '@/application/execute-campaign'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  getCampaignById,
  incrementCampaignSent,
  updateCampaign,
  transitionCampaignStatus,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { emitEvent } from '@/application/emit-event'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/services/template-renderer'
import { resolveTargetMembers } from '@/application/resolve-campaign-members'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
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
import { okResult } from '@/test-utils/send-result'

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
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', { status: 'completed' })
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
    vi.mocked(findTemplateById).mockResolvedValue(null)

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
    vi.mocked(findTemplateById).mockResolvedValue(pendingTemplate)

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
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', { status: 'completed' })
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
    vi.mocked(findTemplateById).mockResolvedValue(template)
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
    vi.mocked(findTemplateById).mockResolvedValue(marketingTemplate)
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
    vi.mocked(findTemplateById).mockResolvedValue(marketingTemplate)
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
    vi.mocked(findTemplateById).mockResolvedValue(marketingTemplate)
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

    // All 3 members produced inserts (3 body + 3 QR = 6)
    expect(insertQueued).toHaveBeenCalledTimes(6)
    // Failed body for m-2 went through markFailedNoBspId
    expect(markFailedNoBspId).toHaveBeenCalled()
    // Status still flips to completed because the batch tolerates failures
    expect(updateCampaign).toHaveBeenCalledWith('camp-1', { status: 'completed' })
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
    vi.mocked(findTemplateById).mockResolvedValue(marketingTemplate)
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
    vi.mocked(findTemplateById).mockResolvedValue(marketingTemplate)
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
    vi.mocked(findTemplateById).mockResolvedValue(marketingTemplate)
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
    }
    vi.mocked(getSettingsForTenant).mockResolvedValue(settings)

    vi.mocked(getCampaignById).mockResolvedValue(campaign)
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateById).mockResolvedValue(marketingTemplate)
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
