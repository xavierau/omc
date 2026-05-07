import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  updateCampaign: vi.fn(),
  transitionCampaignStatus: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantPhoneNumberId: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository', () => ({
  getRestaurantDefaultLanguage: vi.fn().mockResolvedValue('en'),
}))
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository', () => ({
  findTemplateById: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/campaign-settings-repository', () => ({
  getSettingsForTenant: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/application/check-reconfirmation-eligibility', () => ({
  checkReconfirmationEligibility: vi.fn(),
}))
vi.mock('@/application/resolve-reconfirmation-audience', () => ({
  resolveReconfirmationAudience: vi.fn(),
}))
vi.mock('@/application/execute-reconfirmation-batch', () => ({
  executeReconfirmationBatch: vi.fn(),
}))
vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

import { executeReconfirmationCampaign } from '../execute-reconfirmation-campaign'
import {
  updateCampaign,
  transitionCampaignStatus,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { checkReconfirmationEligibility } from '@/application/check-reconfirmation-eligibility'
import { resolveReconfirmationAudience } from '@/application/resolve-reconfirmation-audience'
import { executeReconfirmationBatch } from '@/application/execute-reconfirmation-batch'
import { emitEvent } from '@/application/emit-event'
import {
  ReconfirmationEligibilityError,
  ReconfirmationTemplateError,
} from '@/domain/services/__errors__/reconfirmation-errors'

function buildTemplate(
  overrides: Partial<WhatsAppTemplate> = {}
): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'r-1',
    metaTemplateId: 'meta-1',
    name: 'reconfirm_legacy',
    language: 'en',
    category: 'UTILITY',
    status: 'approved',
    components: [],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c-1',
    restaurantId: 'r-1',
    name: 'Reconfirm',
    type: 'promo',
    template: '',
    templateEn: 'YES?',
    templateZhHk: 'YES?',
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'active',
    mode: 'reconfirmation',
    isChargeable: false,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: 'tpl-1',
    targetAudience: 'all',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function happyEligibility() {
  return {
    allowed: true,
    violations: [],
    audienceCount: 5,
    currentDailySent: 0,
    cap: 50,
  }
}

const audienceRows = [
  { memberId: 'm-1', phoneE164: '85291111111', preferredLanguage: 'en' as const },
  { memberId: 'm-2', phoneE164: '85292222222', preferredLanguage: null },
]

describe('executeReconfirmationCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkReconfirmationEligibility).mockResolvedValue(
      happyEligibility()
    )
    vi.mocked(resolveReconfirmationAudience).mockResolvedValue(audienceRows)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-id-1')
    vi.mocked(findTemplateById).mockResolvedValue(buildTemplate())
    vi.mocked(transitionCampaignStatus).mockResolvedValue(true)
    vi.mocked(emitEvent).mockResolvedValue('evt-1')
  })

  it('throws ReconfirmationEligibilityError when pre-flight fails', async () => {
    vi.mocked(checkReconfirmationEligibility).mockResolvedValue({
      allowed: false,
      violations: [{ key: 'quality_not_green' }],
      audienceCount: 0,
      currentDailySent: 0,
      cap: 50,
    })

    await expect(
      executeReconfirmationCampaign({
        campaign: buildCampaign(),
        restaurantId: 'r-1',
      })
    ).rejects.toBeInstanceOf(ReconfirmationEligibilityError)
    expect(transitionCampaignStatus).not.toHaveBeenCalled()
    expect(executeReconfirmationBatch).not.toHaveBeenCalled()
  })

  it('throws ReconfirmationTemplateError(not_utility) when template is MARKETING', async () => {
    vi.mocked(findTemplateById).mockResolvedValue(
      buildTemplate({ category: 'MARKETING' })
    )

    await expect(
      executeReconfirmationCampaign({
        campaign: buildCampaign(),
        restaurantId: 'r-1',
      })
    ).rejects.toBeInstanceOf(ReconfirmationTemplateError)
    expect(transitionCampaignStatus).not.toHaveBeenCalled()
  })

  it('throws ReconfirmationTemplateError(not_approved) when template is not approved', async () => {
    vi.mocked(findTemplateById).mockResolvedValue(
      buildTemplate({ status: 'pending' })
    )

    await expect(
      executeReconfirmationCampaign({
        campaign: buildCampaign(),
        restaurantId: 'r-1',
      })
    ).rejects.toMatchObject({ reason: 'not_approved' })
  })

  it('throws ReconfirmationTemplateError(not_utility) when whatsappTemplateId is null', async () => {
    const c = buildCampaign({ whatsappTemplateId: null })

    await expect(
      executeReconfirmationCampaign({ campaign: c, restaurantId: 'r-1' })
    ).rejects.toBeInstanceOf(ReconfirmationTemplateError)
  })

  it('happy path: transitions, emits campaign event with mode+audienceCount, sends, completes', async () => {
    await executeReconfirmationCampaign({
      campaign: buildCampaign(),
      restaurantId: 'r-1',
    })

    expect(transitionCampaignStatus).toHaveBeenCalledWith(
      'c-1',
      'active',
      'sending'
    )
    expect(emitEvent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      memberId: null,
      type: 'campaign',
      dataJson: { mode: 'reconfirmation', audienceCount: 2, campaignId: 'c-1' },
    })
    expect(executeReconfirmationBatch).toHaveBeenCalledTimes(1)
    expect(updateCampaign).toHaveBeenCalledWith('c-1', { status: 'completed' })
  })

  it('caps the audience at remaining daily allotment (cap - currentDailySent)', async () => {
    vi.mocked(checkReconfirmationEligibility).mockResolvedValue({
      ...happyEligibility(),
      cap: 50,
      currentDailySent: 49,
    })

    await executeReconfirmationCampaign({
      campaign: buildCampaign(),
      restaurantId: 'r-1',
    })

    expect(resolveReconfirmationAudience).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      remainingCap: 1,
    })
    // Reconfirmation batch is called with dailyAllotment matching the
    // remaining cap (defence-in-depth — both the audience SELECT limit and
    // the slice within the batch enforce the same ceiling).
    expect(executeReconfirmationBatch).toHaveBeenCalledWith(
      expect.objectContaining({ dailyAllotment: 1 })
    )
  })

  it('reverts campaign back to active on send failure', async () => {
    vi.mocked(executeReconfirmationBatch).mockRejectedValue(new Error('boom'))

    await expect(
      executeReconfirmationCampaign({
        campaign: buildCampaign(),
        restaurantId: 'r-1',
      })
    ).rejects.toThrow('boom')

    expect(updateCampaign).toHaveBeenCalledWith('c-1', { status: 'active' })
  })

  it('returns early without throwing when the audience is empty AFTER eligibility passed', async () => {
    // The window between eligibility and audience resolution can race —
    // somebody opted out of a small audience. We still need to not crash.
    vi.mocked(resolveReconfirmationAudience).mockResolvedValue([])

    await executeReconfirmationCampaign({
      campaign: buildCampaign(),
      restaurantId: 'r-1',
    })

    expect(executeReconfirmationBatch).not.toHaveBeenCalled()
    // Campaign is still completed — empty batch is normal flow at the
    // tail of the daily cap.
    expect(updateCampaign).toHaveBeenCalledWith('c-1', { status: 'completed' })
  })
})
