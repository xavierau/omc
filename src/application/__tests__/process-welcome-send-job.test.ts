// INT-001 WI-4: frozen acceptance suite for `processWelcomeSendJob` (spec
// US-4, threats OD-15/T-H8/T-M11, plan §"Welcome-send job").

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/infrastructure/queue/integration-inbound-queue')
vi.mock('@/infrastructure/supabase/repositories/integration-outbound-member-repository')
vi.mock('@/infrastructure/supabase/repositories/pos-integration-repository')
vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository')
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository')
vi.mock('@/infrastructure/supabase/repositories/tenant-trust-queries')
vi.mock('@/infrastructure/supabase/repositories/integration-member-job-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('../resolve-integration-welcome-template')
vi.mock('../mint-welcome-coupon-idempotent')
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
import {
  updateMemberJobWelcomeOutcome,
  completeMemberJobSucceeded,
  completeMemberJobFailed,
} from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveIntegrationWelcomeTemplate } from '../resolve-integration-welcome-template'
import { mintWelcomeCouponIdempotent } from '../mint-welcome-coupon-idempotent'
import { recordOutboundSend } from '../record-outbound-send'
import { sendWhatsAppTemplateMessage } from '../send-template-message'
import { isMessageTrackingEnabled } from '../message-tracking-flag'
import { notifyOpsAlert } from '../notify-ops-alert'
import type { WelcomeSendJobData } from '@/infrastructure/queue/integration-inbound-queue'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { Campaign } from '@/domain/entities/campaign'
import type { RecordOutboundSendArgs } from '../record-outbound-send'
import type { SendResult } from '@/domain/value-objects/send-result'

function jobData(overrides: Partial<WelcomeSendJobData> = {}): WelcomeSendJobData {
  return {
    memberId: 'm-1',
    restaurantId: 'rest-1',
    integrationId: 'int-1',
    createJobId: 'mj_abc',
    ...overrides,
  }
}

function activeMember(overrides: Partial<{ status: 'active' | 'unsubscribed'; name: string | null }> = {}) {
  return {
    id: 'm-1',
    restaurantId: 'rest-1',
    phone: '+85298765432',
    name: 'Ada',
    status: 'active' as const,
    preferredLanguage: null,
    joinedAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

function activeIntegration() {
  return { id: 'int-1', restaurantId: 'rest-1', status: 'active' } as never
}

function settingsWith(newJoinTemplateId: string | null) {
  return { snapshot: { newJoinTemplateId } } as never
}

function utilityTemplate(overrides: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate {
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

function consentRow(status: string | null) {
  return status ? ({ snapshot: { status } } as never) : null
}

const OK_SEND_RESULT: SendResult = { ok: true, kapsoMessageId: 'wamid.123', raw: null }
const FAILED_SEND_RESULT: SendResult = { ok: false, kapsoMessageId: null, raw: null, error: { title: 'send_failed' } }

describe('processWelcomeSendJob (INT-001 WI-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findMemberForOutboundPayload).mockResolvedValue(activeMember())
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(settingsWith('default'))
    vi.mocked(resolveIntegrationWelcomeTemplate).mockResolvedValue({
      found: true,
      template: utilityTemplate(),
      campaign: campaign(),
    })
    vi.mocked(findLatestConsentByCategory).mockResolvedValue(consentRow('opted_in'))
    vi.mocked(isTenantAutoPaused).mockResolvedValue(false)
    vi.mocked(getInboundRateLimiter).mockReturnValue({
      takeToken: vi.fn(),
      incrWindow: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
      incr: vi.fn(),
      decr: vi.fn(),
      get: vi.fn(),
    } as never)
    vi.mocked(mintWelcomeCouponIdempotent).mockResolvedValue({ code: 'WELCOME1', id: 'cpn-1' })
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-num-id-1')
    vi.mocked(isMessageTrackingEnabled).mockReturnValue(true)
    vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(OK_SEND_RESULT)
    vi.mocked(recordOutboundSend).mockImplementation(async (args: RecordOutboundSendArgs) => args.send())
    vi.mocked(updateMemberJobWelcomeOutcome).mockResolvedValue(undefined)
    vi.mocked(notifyOpsAlert).mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete process.env.INT001_WELCOME_HOURLY_CAP
  })

  it('happy path: sends, mints via campaign, writes welcome_outcome=sent with the whatsapp_message_id', async () => {
    await processWelcomeSendJob(jobData(), 1)

    expect(mintWelcomeCouponIdempotent).toHaveBeenCalledWith('rest-1', 'm-1', 'Ada', campaign())
    expect(sendWhatsAppTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'phone-num-id-1',
        to: '+85298765432',
        couponCode: 'WELCOME1',
        paramValues: expect.objectContaining({ customer_name: 'Ada', code: 'WELCOME1', discount: '10%' }),
      })
    )
    expect(recordOutboundSend).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        memberId: 'm-1',
        campaignId: 'camp-1',
        category: 'utility',
        messageType: 'template',
        contentPreview: '[welcome_partner_api] welcome_utility',
        trackingEnabled: true,
      })
    )
    expect(updateMemberJobWelcomeOutcome).toHaveBeenCalledWith('mj_abc', 'sent', { whatsapp_message_id: 'wamid.123' })
    expect(completeMemberJobSucceeded).not.toHaveBeenCalled()
    expect(completeMemberJobFailed).not.toHaveBeenCalled()
  })

  it('marketing template: category derived from the template, campaignId threaded through', async () => {
    vi.mocked(resolveIntegrationWelcomeTemplate).mockResolvedValue({
      found: true,
      template: utilityTemplate({ category: 'MARKETING', name: 'welcome_marketing' }),
      campaign: campaign(),
    })

    await processWelcomeSendJob(jobData(), 1)

    expect(recordOutboundSend).toHaveBeenCalledWith(expect.objectContaining({ category: 'marketing' }))
  })

  it('no campaign resolved (direct template id): mints via the fallback path, campaignId null', async () => {
    vi.mocked(resolveIntegrationWelcomeTemplate).mockResolvedValue({
      found: true,
      template: utilityTemplate(),
      campaign: null,
    })

    await processWelcomeSendJob(jobData(), 1)

    expect(mintWelcomeCouponIdempotent).toHaveBeenCalledWith('rest-1', 'm-1', 'Ada', null)
    expect(recordOutboundSend).toHaveBeenCalledWith(expect.objectContaining({ campaignId: null }))
  })

  describe('zero coupon rows for every skipped_* outcome', () => {
    const cases: Array<[string, () => void]> = [
      [
        'skipped_member_missing (member deleted between create and send)',
        () => vi.mocked(findMemberForOutboundPayload).mockResolvedValue(null),
      ],
      [
        'skipped_off (integration paused since create)',
        () => vi.mocked(findPosIntegrationById).mockResolvedValue({ id: 'int-1', restaurantId: 'rest-1', status: 'inactive' } as never),
      ],
      [
        'skipped_off (new_join_template_id cleared since create)',
        () => vi.mocked(findIntegrationSettingsById).mockResolvedValue(settingsWith(null)),
      ],
      [
        'skipped_no_template (foreign / deleted / not-approved template)',
        () => vi.mocked(resolveIntegrationWelcomeTemplate).mockResolvedValue({ found: false }),
      ],
      [
        'skipped_opted_out (member unsubscribed since create)',
        () => vi.mocked(findMemberForOutboundPayload).mockResolvedValue(activeMember({ status: 'unsubscribed' })),
      ],
      [
        'skipped_opted_out (category latest opted_out -- STOP between create and send)',
        () =>
          vi.mocked(findLatestConsentByCategory).mockImplementation(async (args: { category: string }) =>
            args.category === 'utility' ? consentRow('opted_out') : consentRow('opted_in')
          ),
      ],
      [
        'skipped_quality_paused (tenant auto-paused, WAQ-009)',
        () => vi.mocked(isTenantAutoPaused).mockResolvedValue(true),
      ],
    ]

    it.each(cases)('%s -> no mint, no send, no create-job write', async (_label, arrange) => {
      arrange()

      await processWelcomeSendJob(jobData(), 1)

      expect(mintWelcomeCouponIdempotent).not.toHaveBeenCalled()
      expect(recordOutboundSend).not.toHaveBeenCalled()
      expect(sendWhatsAppTemplateMessage).not.toHaveBeenCalled()
      expect(completeMemberJobSucceeded).not.toHaveBeenCalled()
      expect(completeMemberJobFailed).not.toHaveBeenCalled()
      expect(updateMemberJobWelcomeOutcome).toHaveBeenCalledTimes(1)
      const [, outcome] = vi.mocked(updateMemberJobWelcomeOutcome).mock.calls[0]
      expect(outcome).not.toBe('sent')
      expect(outcome).not.toBe('queued')
    })
  })

  it('marketing template + utility level -> skipped_consent_level {required_level: all, effective_level: utility}', async () => {
    vi.mocked(resolveIntegrationWelcomeTemplate).mockResolvedValue({
      found: true,
      template: utilityTemplate({ category: 'MARKETING' }),
      campaign: campaign(),
    })
    vi.mocked(findLatestConsentByCategory).mockImplementation(async (args: { category: string }) =>
      args.category === 'utility' ? consentRow('opted_in') : consentRow(null)
    )

    await processWelcomeSendJob(jobData(), 1)

    expect(updateMemberJobWelcomeOutcome).toHaveBeenCalledWith('mj_abc', 'skipped_consent_level', {
      required_level: 'all',
      effective_level: 'utility',
    })
    expect(mintWelcomeCouponIdempotent).not.toHaveBeenCalled()
  })

  it('utility template + none level -> skipped_consent_level {required_level: utility, effective_level: none}', async () => {
    vi.mocked(findLatestConsentByCategory).mockResolvedValue(null)

    await processWelcomeSendJob(jobData(), 1)

    expect(updateMemberJobWelcomeOutcome).toHaveBeenCalledWith('mj_abc', 'skipped_consent_level', {
      required_level: 'utility',
      effective_level: 'none',
    })
  })

  it('utility template + utility level -> sent', async () => {
    vi.mocked(findLatestConsentByCategory).mockImplementation(async (args: { category: string }) =>
      args.category === 'utility' ? consentRow('opted_in') : consentRow(null)
    )

    await processWelcomeSendJob(jobData(), 1)

    expect(updateMemberJobWelcomeOutcome).toHaveBeenCalledWith('mj_abc', 'sent', expect.any(Object))
  })

  it('crash-between-mint-and-send retry: mint is idempotent by construction (delegated to mintWelcomeCouponIdempotent), one attempt = one mint call', async () => {
    // The idempotency guarantee itself (exactly one coupon row across
    // retries) is proven at the mint module's own level
    // (mint-welcome-coupon-idempotent.test.ts). Here we assert THIS job
    // calls it exactly once per attempt -- a retry re-runs the whole
    // pipeline (attempt 2) and calls it again, which mintWelcomeCouponIdempotent
    // itself resolves to the SAME coupon rather than minting twice.
    await processWelcomeSendJob(jobData(), 1)
    expect(mintWelcomeCouponIdempotent).toHaveBeenCalledTimes(1)
  })

  describe('send failure', () => {
    beforeEach(() => {
      vi.mocked(sendWhatsAppTemplateMessage).mockResolvedValue(FAILED_SEND_RESULT)
    })

    it('throws (transient, BullMQ retries), never touches the create job row status, and does not alert before the final attempt', async () => {
      await expect(processWelcomeSendJob(jobData(), 1, 3)).rejects.toThrow('send failed')

      expect(completeMemberJobSucceeded).not.toHaveBeenCalled()
      expect(completeMemberJobFailed).not.toHaveBeenCalled()
      expect(updateMemberJobWelcomeOutcome).not.toHaveBeenCalled()
      expect(notifyOpsAlert).not.toHaveBeenCalled()
    })

    it('on the final attempt: welcome_outcome=failed, ops alert fired, create job row still untouched', async () => {
      await expect(processWelcomeSendJob(jobData(), 3, 3)).rejects.toThrow('send failed')

      expect(updateMemberJobWelcomeOutcome).toHaveBeenCalledWith('mj_abc', 'failed', null)
      expect(notifyOpsAlert).toHaveBeenCalledTimes(1)
      expect(completeMemberJobSucceeded).not.toHaveBeenCalled()
      expect(completeMemberJobFailed).not.toHaveBeenCalled()
    })
  })

  describe('per-tenant hourly send cap (T-H8)', () => {
    it('boundary: Nth send OK, N+1th skipped_rate_capped, no mint/send on the capped one', async () => {
      process.env.INT001_WELCOME_HOURLY_CAP = '2'
      let count = 0
      vi.mocked(getInboundRateLimiter).mockReturnValue({
        takeToken: vi.fn(),
        incrWindow: vi.fn().mockImplementation(async () => {
          count += 1
          return { allowed: count <= 2, count }
        }),
        incr: vi.fn(),
        decr: vi.fn(),
        get: vi.fn(),
      } as never)

      await processWelcomeSendJob(jobData({ createJobId: 'mj_1' }), 1)
      await processWelcomeSendJob(jobData({ createJobId: 'mj_2' }), 1)
      await processWelcomeSendJob(jobData({ createJobId: 'mj_3' }), 1)

      expect(mintWelcomeCouponIdempotent).toHaveBeenCalledTimes(2)
      expect(updateMemberJobWelcomeOutcome).toHaveBeenNthCalledWith(1, 'mj_1', 'sent', expect.any(Object))
      expect(updateMemberJobWelcomeOutcome).toHaveBeenNthCalledWith(2, 'mj_2', 'sent', expect.any(Object))
      expect(updateMemberJobWelcomeOutcome).toHaveBeenNthCalledWith(3, 'mj_3', 'skipped_rate_capped', null)
    })

    it('does not consume the cap counter for a job that skips for an earlier reason (provisional decision)', async () => {
      vi.mocked(resolveIntegrationWelcomeTemplate).mockResolvedValue({ found: false })
      const incrWindow = vi.fn().mockResolvedValue({ allowed: true, count: 1 })
      vi.mocked(getInboundRateLimiter).mockReturnValue({
        takeToken: vi.fn(),
        incrWindow,
        incr: vi.fn(),
        decr: vi.fn(),
        get: vi.fn(),
      } as never)

      await processWelcomeSendJob(jobData(), 1)

      expect(incrWindow).not.toHaveBeenCalled()
    })
  })
})
