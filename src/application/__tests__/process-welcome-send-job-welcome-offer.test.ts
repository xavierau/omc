// WONB-020 r6 J1: the partner welcome job's mint must write a coupon marked
// welcome_offer, so the claim check never depends on the campaign's current
// type. Runs the REAL mint and coupon factory; only the coupon insert (and
// the job's other collaborators) are faked.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/queue/integration-inbound-queue')
vi.mock('@/infrastructure/supabase/repositories/integration-outbound-member-repository')
vi.mock('@/infrastructure/supabase/repositories/pos-integration-repository')
vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository')
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository')
vi.mock('@/infrastructure/supabase/repositories/tenant-trust-queries')
vi.mock('@/infrastructure/supabase/repositories/integration-member-job-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/coupon-repository', () => ({
  createCoupon: vi.fn(),
  findCouponByMemberAndCampaign: vi.fn(),
  findWelcomeCouponByMember: vi.fn(),
}))
vi.mock('../resolve-integration-welcome-template')
vi.mock('../record-outbound-send')
vi.mock('../send-template-message')
vi.mock('../message-tracking-flag')
vi.mock('../notify-ops-alert')

import { processWelcomeSendJob } from '../process-welcome-send-job'
import { getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { findMemberForOutboundPayload } from '@/infrastructure/supabase/repositories/integration-outbound-member-repository'
import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { findLatestConsentByCategory } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { isTenantAutoPaused } from '@/infrastructure/supabase/repositories/tenant-trust-queries'
import { findMemberJobForIntegration } from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  createCoupon,
  findCouponByMemberAndCampaign,
  findWelcomeCouponByMember,
} from '@/infrastructure/supabase/repositories/coupon-repository'
import { resolveIntegrationWelcomeTemplate } from '../resolve-integration-welcome-template'
import { recordOutboundSend } from '../record-outbound-send'
import { sendWhatsAppTemplateMessage } from '../send-template-message'
import { isMessageTrackingEnabled } from '../message-tracking-flag'
import type { Campaign } from '@/domain/entities/campaign'
import type { Coupon } from '@/domain/entities/coupon'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { RecordOutboundSendArgs } from '../record-outbound-send'

const JOB = { memberId: 'm-1', restaurantId: 'rest-1', integrationId: 'int-1', createJobId: 'mj_abc' }

function welcomeCampaign(): Campaign {
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
    lastEnqueuedAt: null,
  }
}

function template(): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'rest-1',
    metaTemplateId: 'meta-1',
    name: 'welcome_utility',
    language: 'en',
    category: 'UTILITY',
    status: 'approved',
    components: [],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('processWelcomeSendJob mints a welcome_offer coupon (WONB-020 r6 J1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findMemberForOutboundPayload).mockResolvedValue({
      id: 'm-1',
      restaurantId: 'rest-1',
      phone: '+85298765432',
      name: 'Ada',
      status: 'active',
      preferredLanguage: null,
      joinedAt: '2026-09-10T00:00:00.000Z',
    } as never)
    vi.mocked(findPosIntegrationById).mockResolvedValue({ id: 'int-1', restaurantId: 'rest-1', status: 'active' } as never)
    vi.mocked(findIntegrationSettingsById).mockResolvedValue({ snapshot: { newJoinTemplateId: 'default' } } as never)
    vi.mocked(findLatestConsentByCategory).mockResolvedValue({ snapshot: { status: 'opted_in' } } as never)
    vi.mocked(isTenantAutoPaused).mockResolvedValue(false)
    vi.mocked(getInboundRateLimiter).mockReturnValue({
      incrWindow: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
    } as never)
    vi.mocked(findMemberJobForIntegration).mockResolvedValue({ welcome_outcome: null } as never)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('pn-1')
    vi.mocked(isMessageTrackingEnabled).mockReturnValue(true)
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue({ ok: true, kapsoMessageId: 'wamid.1', raw: null })
    vi.mocked(recordOutboundSend).mockImplementation(async (args: RecordOutboundSendArgs) => args.send())
    vi.mocked(findCouponByMemberAndCampaign).mockResolvedValue(null)
    vi.mocked(findWelcomeCouponByMember).mockResolvedValue(null)
    vi.mocked(createCoupon).mockResolvedValue({ id: 'cpn-1', code: 'WELCOME1' } as Coupon)
  })

  it('welcome campaign resolved -> the campaign coupon insert carries welcomeOffer: true', async () => {
    vi.mocked(resolveIntegrationWelcomeTemplate).mockResolvedValue({ found: true, template: template(), campaign: welcomeCampaign() })

    await processWelcomeSendJob(JOB, 1)

    expect(createCoupon).toHaveBeenCalledTimes(1)
    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'promo', campaignId: 'camp-1', memberId: 'm-1', welcomeOffer: true })
    )
  })

  it('no campaign (fallback welcome mint) -> the insert carries welcomeOffer: true', async () => {
    vi.mocked(resolveIntegrationWelcomeTemplate).mockResolvedValue({ found: true, template: template(), campaign: null })

    await processWelcomeSendJob(JOB, 1)

    expect(createCoupon).toHaveBeenCalledTimes(1)
    expect(createCoupon).toHaveBeenCalledWith(expect.objectContaining({ type: 'welcome', memberId: 'm-1', welcomeOffer: true }))
  })
})
