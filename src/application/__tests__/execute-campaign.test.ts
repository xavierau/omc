import { describe, it, expect, vi, beforeEach } from 'vitest'
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
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/services/template-renderer'
import { resolveTargetMembers } from '@/application/resolve-campaign-members'
import { sendWhatsAppTemplateMessage } from '@/application/send-template-message'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    restaurantId: 'r-1',
    name: 'Test Campaign',
    type: 'promo',
    template: 'Hi {{name}}, use {{code}} for {{discount}} off!',
    templateEn: null,
    templateZhHk: null,
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
