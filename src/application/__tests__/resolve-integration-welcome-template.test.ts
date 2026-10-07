// INT-001 WI-4 (T-M11): frozen suite for the send-time template resolution
// rule. `'default'` -> onboarding welcomeCampaignId -> campaign
// whatsappTemplateId -> findByIdForRestaurant; a uuid -> findByIdForRestaurant
// directly. Every miss collapses to `{ found: false }`.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository')

import { resolveIntegrationWelcomeTemplate } from '../resolve-integration-welcome-template'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { getCampaignByIdForRestaurant } from '@/infrastructure/supabase/repositories/campaign-repository'
import { findByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { Campaign } from '@/domain/entities/campaign'

function approvedTemplate(overrides: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'rest-1',
    metaTemplateId: 'meta-1',
    name: 'welcome_tpl',
    language: 'en',
    category: 'UTILITY',
    status: 'approved',
    components: [],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    restaurantId: 'rest-1',
    name: 'Welcome',
    type: 'welcome',
    template: 'hi {{name}}',
    templateEn: null,
    templateZhHk: null,
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 30 },
    schedule: null,
    scheduledAt: null,
    status: 'active',
    failureReason: null,
    isChargeable: true,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: 'tpl-1',
    targetAudience: 'all',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveIntegrationWelcomeTemplate (INT-001 WI-4, T-M11)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('"default" resolves via onboarding welcomeCampaignId -> campaign whatsappTemplateId -> approved template', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(campaign())
    vi.mocked(findByIdForRestaurant).mockResolvedValue(approvedTemplate())

    const result = await resolveIntegrationWelcomeTemplate('default', 'rest-1')

    expect(result).toEqual({ found: true, template: approvedTemplate(), campaign: campaign() })
    expect(getCampaignByIdForRestaurant).toHaveBeenCalledWith('camp-1', 'rest-1')
    expect(findByIdForRestaurant).toHaveBeenCalledWith('tpl-1', 'rest-1')
  })

  it('"default" with no onboarding welcomeCampaignId -> not found', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })

    const result = await resolveIntegrationWelcomeTemplate('default', 'rest-1')

    expect(result).toEqual({ found: false })
    expect(getCampaignByIdForRestaurant).not.toHaveBeenCalled()
  })

  it('"default" whose onboarding read throws -> not found, not a crash', async () => {
    vi.mocked(getOnboardingSettings).mockRejectedValue(new Error('db down'))

    const result = await resolveIntegrationWelcomeTemplate('default', 'rest-1')

    expect(result).toEqual({ found: false })
  })

  it('"default" campaign with no whatsappTemplateId -> not found', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(campaign({ whatsappTemplateId: null }))

    const result = await resolveIntegrationWelcomeTemplate('default', 'rest-1')

    expect(result).toEqual({ found: false })
    expect(findByIdForRestaurant).not.toHaveBeenCalled()
  })

  it('"default" campaign resolved via a template that is not approved -> not found', async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(campaign())
    vi.mocked(findByIdForRestaurant).mockResolvedValue(approvedTemplate({ status: 'paused' }))

    const result = await resolveIntegrationWelcomeTemplate('default', 'rest-1')

    expect(result).toEqual({ found: false })
  })

  it('a specific template id resolves directly, tenant-scoped, no campaign', async () => {
    vi.mocked(findByIdForRestaurant).mockResolvedValue(approvedTemplate({ id: 'tpl-2' }))

    const result = await resolveIntegrationWelcomeTemplate('tpl-2', 'rest-1')

    expect(result).toEqual({ found: true, template: approvedTemplate({ id: 'tpl-2' }), campaign: null })
    expect(findByIdForRestaurant).toHaveBeenCalledWith('tpl-2', 'rest-1')
    expect(getOnboardingSettings).not.toHaveBeenCalled()
  })

  it('a template id owned by another tenant (findByIdForRestaurant scoping) -> not found (T-M11)', async () => {
    // findByIdForRestaurant itself returns null for a foreign id -- this is
    // exactly the scoped-query behaviour we depend on.
    vi.mocked(findByIdForRestaurant).mockResolvedValue(null)

    const result = await resolveIntegrationWelcomeTemplate('foreign-tpl', 'rest-1')

    expect(result).toEqual({ found: false })
  })

  it('a template id that is not approved -> not found', async () => {
    vi.mocked(findByIdForRestaurant).mockResolvedValue(approvedTemplate({ status: 'pending' }))

    const result = await resolveIntegrationWelcomeTemplate('tpl-pending', 'rest-1')

    expect(result).toEqual({ found: false })
  })
})
