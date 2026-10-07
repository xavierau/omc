// INT-001 WI-3: frozen acceptance suite for `processMemberCreateJob`
// (spec US-1/US-3/US-4, plan §"Member-create job (worker)").

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/pos-integration-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository')
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository')
vi.mock('@/infrastructure/supabase/repositories/integration-member-ref-repository')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository')
vi.mock('@/infrastructure/supabase/repositories/tenant-trust-queries')
vi.mock('@/infrastructure/supabase/repositories/integration-member-job-repository')
vi.mock('@/infrastructure/queue/integration-inbound-queue')
vi.mock('@/application/create-or-get-member')
vi.mock('@/application/emit-event')
vi.mock('@/application/notify-ops-alert')

import { processMemberCreateJob } from '../process-member-create-job'
import { createOrGetMember } from '../create-or-get-member'
import { emitEvent } from '../emit-event'
import { notifyOpsAlert } from '../notify-ops-alert'
import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { getRestaurantTenantStatus, getRestaurantName } from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  getOnboardingSettings,
  getRestaurantDefaultLanguage,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import {
  applyPartnerAssertedConsent,
  findLatestConsentByCategory,
} from '@/infrastructure/supabase/repositories/consent-record-repository'
import { upsertIntegrationMemberRef } from '@/infrastructure/supabase/repositories/integration-member-ref-repository'
import { getCampaignByIdForRestaurant } from '@/infrastructure/supabase/repositories/campaign-repository'
import { findTemplateByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { isTenantAutoPaused } from '@/infrastructure/supabase/repositories/tenant-trust-queries'
import {
  markMemberJobProcessing,
  completeMemberJobSucceeded,
  completeMemberJobFailed,
  findMemberJobForIntegration,
  recordMemberJobMemberId,
} from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import { addWelcomeSendJob, getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import type { MemberCreateJobData } from '@/infrastructure/queue/integration-inbound-queue'

function jobData(overrides: Partial<MemberCreateJobData> = {}): MemberCreateJobData {
  return {
    jobId: 'mj_abc',
    integrationId: 'int-1',
    restaurantId: 'rest-1',
    phoneE164: '+85298765432',
    consentLevel: 'all',
    name: 'Ada',
    externalRef: null,
    language: null,
    sendWelcome: true,
    metadata: null,
    ...overrides,
  }
}

function activeIntegration() {
  return { id: 'int-1', restaurantId: 'rest-1', status: 'active' } as never
}

function activeTenant(): { status: 'active' | 'inactive' | 'trial'; trialExpiresAt: string | null } {
  return { status: 'active', trialExpiresAt: null }
}

function noSettings() {
  return null
}

function consentStatus(status: string | null) {
  return status ? ({ snapshot: { status } } as never) : null
}

describe('processMemberCreateJob (INT-001 WI-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    vi.mocked(getRestaurantTenantStatus).mockResolvedValue(activeTenant())
    vi.mocked(getRestaurantName).mockResolvedValue('OhMyClient Demo')
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(noSettings())
    vi.mocked(applyPartnerAssertedConsent).mockResolvedValue('inserted')
    vi.mocked(findLatestConsentByCategory).mockResolvedValue(consentStatus('opted_in'))
    vi.mocked(upsertIntegrationMemberRef).mockResolvedValue(undefined)
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue(null)
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(null)
    vi.mocked(isTenantAutoPaused).mockResolvedValue(false)
    vi.mocked(markMemberJobProcessing).mockResolvedValue(undefined)
    vi.mocked(completeMemberJobSucceeded).mockResolvedValue(undefined)
    vi.mocked(completeMemberJobFailed).mockResolvedValue(undefined)
    vi.mocked(addWelcomeSendJob).mockResolvedValue(undefined)
    vi.mocked(emitEvent).mockResolvedValue('evt-1')
    vi.mocked(notifyOpsAlert).mockResolvedValue(undefined)
    vi.mocked(getInboundRateLimiter).mockReturnValue({
      takeToken: vi.fn(),
      incrWindow: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
      incr: vi.fn(),
      decr: vi.fn().mockResolvedValue(0),
      get: vi.fn(),
    } as never)
    vi.mocked(createOrGetMember).mockResolvedValue({ outcome: 'created', memberId: 'm-1', status: 'active' })
    vi.mocked(findMemberJobForIntegration).mockResolvedValue({ member_id: null } as never)
    vi.mocked(recordMemberJobMemberId).mockResolvedValue(undefined)
  })

  it('new member: created, consent written per category, join event with source partner_api and no coupon_code, welcome_off recorded, job marked succeeded', async () => {
    await processMemberCreateJob(jobData(), 1)

    expect(applyPartnerAssertedConsent).toHaveBeenCalledTimes(2)
    expect(applyPartnerAssertedConsent).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'utility', grade: 'weak', consentText: null })
    )
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'join',
        memberId: 'm-1',
        dataJson: { source: 'partner_api', integration_id: 'int-1' },
        source: 'pos:int-1',
      })
    )
    const emittedArg = vi.mocked(emitEvent).mock.calls[0][0] as Record<string, unknown>
    expect(emittedArg.dataJson).not.toHaveProperty('coupon_code')

    expect(completeMemberJobSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'mj_abc', outcome: 'created', memberId: 'm-1', welcomeOutcome: 'skipped_off' })
    )
  })

  it('existing member: outcome existing, no join event, welcome skipped_existing', async () => {
    vi.mocked(createOrGetMember).mockResolvedValue({ outcome: 'existing', memberId: 'm-2', status: 'active' })

    await processMemberCreateJob(jobData(), 1)

    expect(emitEvent).not.toHaveBeenCalled()
    expect(completeMemberJobSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'existing', welcomeOutcome: 'skipped_existing' })
    )
  })

  it('externalRef present -> upserts integration_member_refs; absent -> never called', async () => {
    await processMemberCreateJob(jobData({ externalRef: 'ext-99' }), 1)
    expect(upsertIntegrationMemberRef).toHaveBeenCalledWith({
      memberId: 'm-1',
      integrationId: 'int-1',
      externalRef: 'ext-99',
    })

    vi.clearAllMocks()
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    vi.mocked(getRestaurantTenantStatus).mockResolvedValue(activeTenant())
    vi.mocked(createOrGetMember).mockResolvedValue({ outcome: 'created', memberId: 'm-1', status: 'active' })
    vi.mocked(findLatestConsentByCategory).mockResolvedValue(consentStatus('opted_in'))
    await processMemberCreateJob(jobData({ externalRef: null }), 1)
    expect(upsertIntegrationMemberRef).not.toHaveBeenCalled()
  })

  it('integration paused -> permanent failure, job row failed integration_paused, throws (UnrecoverableError)', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue({ id: 'int-1', restaurantId: 'rest-1', status: 'inactive' } as never)

    await expect(processMemberCreateJob(jobData(), 1)).rejects.toThrow()

    expect(completeMemberJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'mj_abc', errorCode: 'integration_paused' })
    )
    expect(createOrGetMember).not.toHaveBeenCalled()
  })

  it('tenant inactive -> permanent failure, job row failed tenant_inactive', async () => {
    vi.mocked(getRestaurantTenantStatus).mockResolvedValue({ status: 'inactive' as const, trialExpiresAt: null })

    await expect(processMemberCreateJob(jobData(), 1)).rejects.toThrow()

    expect(completeMemberJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'tenant_inactive' })
    )
  })

  it('transient error on a non-final attempt: job row NOT marked failed, plain error rethrown (BullMQ retries)', async () => {
    vi.mocked(createOrGetMember).mockRejectedValue(new Error('db timeout'))

    await expect(processMemberCreateJob(jobData(), 1, 3)).rejects.toThrow(/db timeout/)

    expect(completeMemberJobFailed).not.toHaveBeenCalled()
    expect(notifyOpsAlert).not.toHaveBeenCalled()
  })

  it('transient error on the FINAL attempt: job row marked failed internal + engineering alert', async () => {
    vi.mocked(createOrGetMember).mockRejectedValue(new Error('db timeout'))

    await expect(processMemberCreateJob(jobData(), 3, 3)).rejects.toThrow()

    expect(completeMemberJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'internal' })
    )
    expect(notifyOpsAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'engineering_alert' }))
  })

  // I-3 (defense in depth): whatever thrown an error message with a
  // phone-shaped substring (the consent read-then-write race being the
  // known case -- see consent-record-repository.test.ts's own I-3
  // coverage, closed at the source there) must not carry it into the job
  // row's error_message, the Slack alert, or the re-thrown error the
  // worker's `.on('failed')` handler logs (T-H7: no PII in job row/Slack/
  // logs).
  it('I-3: a thrown error whose message embeds an E.164-shaped phone is redacted to last4 before it reaches the job row, Slack, or the re-thrown error', async () => {
    vi.mocked(createOrGetMember).mockRejectedValue(
      new Error('consent already exists for (rest-1, +85298765432, utility)')
    )

    await expect(processMemberCreateJob(jobData(), 3, 3)).rejects.not.toThrow(/\+85298765432/)

    const failedCall = vi.mocked(completeMemberJobFailed).mock.calls[0][0]
    expect(failedCall.errorMessage).not.toContain('+85298765432')
    expect(failedCall.errorMessage).toContain('5432') // last4 preserved for triage

    const alertCall = vi.mocked(notifyOpsAlert).mock.calls[0][0]
    expect(JSON.stringify(alertCall)).not.toContain('+85298765432')
  })

  it('depth counter is released (decr) on every terminal outcome: success, permanent failure, and final-attempt transient failure', async () => {
    const limiter = {
      takeToken: vi.fn(),
      incrWindow: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
      incr: vi.fn(),
      decr: vi.fn().mockResolvedValue(0),
      get: vi.fn(),
    }
    vi.mocked(getInboundRateLimiter).mockReturnValue(limiter as never)

    await processMemberCreateJob(jobData(), 1)
    expect(limiter.decr).toHaveBeenCalledWith('int001:depth:int-1')

    limiter.decr.mockClear()
    vi.mocked(findPosIntegrationById).mockResolvedValue({ id: 'int-1', restaurantId: 'rest-1', status: 'inactive' } as never)
    await expect(processMemberCreateJob(jobData(), 1)).rejects.toThrow()
    expect(limiter.decr).toHaveBeenCalledWith('int001:depth:int-1')
  })

  it('template configured + consent covers it -> enqueues welcome-send with wel:memberId:createJobId, welcomeOutcome queued', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue({
      snapshot: { newJoinTemplateId: 'default', consentAttestationText: null, consentAttestationAckAt: null },
    } as never)
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'zh_hk',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue({ whatsappTemplateId: 'tpl-1' } as never)
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
      id: 'tpl-1',
      restaurantId: 'rest-1',
      category: 'MARKETING',
      status: 'approved',
    } as never)
    vi.mocked(findLatestConsentByCategory).mockResolvedValue(consentStatus('opted_in'))

    await processMemberCreateJob(jobData({ jobId: 'mj_abc' }), 1)

    expect(addWelcomeSendJob).toHaveBeenCalledWith('wel:m-1:mj_abc', {
      memberId: 'm-1',
      restaurantId: 'rest-1',
      integrationId: 'int-1',
      createJobId: 'mj_abc',
    })
    expect(completeMemberJobSucceeded).toHaveBeenCalledWith(expect.objectContaining({ welcomeOutcome: 'queued' }))
  })

  // G-1 (Grok review, corroborates the analyzer review's own M-2): a genuine
  // DB insert succeeding on attempt 1, followed by a crash/retry BEFORE
  // completeMemberJobSucceeded ever runs, makes attempt 2's own
  // createOrGetMember see the member as `existing` (it's the SAME job's
  // own earlier write) -- decideWelcome's D1 rule ("existing member never
  // gets a welcome") then incorrectly treats this as a genuinely
  // pre-existing member and skips the welcome the first attempt would have
  // sent. Fixed by recording `member_id` on the job row as soon as it's
  // known (not only at completeMemberJobSucceeded), and reading it back
  // BEFORE createOrGetMember on every attempt: if this attempt's
  // createOrGetMember also resolves to that SAME member_id, treat it as
  // "created by an earlier attempt of THIS job", not a pre-existing
  // member, for welcome-decision purposes only.
  describe('G-1: welcome is not skipped on a create-job retry after a successful-but-uncommitted earlier attempt', () => {
    beforeEach(() => {
      vi.mocked(findIntegrationSettingsById).mockResolvedValue({
        snapshot: { newJoinTemplateId: 'default', consentAttestationText: null, consentAttestationAckAt: null },
      } as never)
      vi.mocked(getOnboardingSettings).mockResolvedValue({
        welcomeCampaignId: 'camp-1',
        returningMemberTemplate: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
        defaultLanguage: 'zh_hk',
      })
      vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue({ whatsappTemplateId: 'tpl-1' } as never)
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
        id: 'tpl-1',
        restaurantId: 'rest-1',
        category: 'MARKETING',
        status: 'approved',
      } as never)
      vi.mocked(findLatestConsentByCategory).mockResolvedValue(consentStatus('opted_in'))
    })

    it('retry attempt: job row already carries member_id from attempt 1, createOrGetMember now resolves the SAME member as `existing` -> welcome is still enqueued (not skipped_existing)', async () => {
      vi.mocked(findMemberJobForIntegration).mockResolvedValue({ member_id: 'm-1' } as never)
      vi.mocked(createOrGetMember).mockResolvedValue({ outcome: 'existing', memberId: 'm-1', status: 'active' })

      await processMemberCreateJob(jobData({ jobId: 'mj_abc' }), 2, 3)

      expect(addWelcomeSendJob).toHaveBeenCalledWith('wel:m-1:mj_abc', {
        memberId: 'm-1',
        restaurantId: 'rest-1',
        integrationId: 'int-1',
        createJobId: 'mj_abc',
      })
      expect(completeMemberJobSucceeded).toHaveBeenCalledWith(expect.objectContaining({ welcomeOutcome: 'queued' }))
    })

    it('first attempt: createOrGetMember resolves `created` -> the member_id is recorded on the job row immediately (before completeMemberJobSucceeded), not only on success', async () => {
      vi.mocked(createOrGetMember).mockResolvedValue({ outcome: 'created', memberId: 'm-1', status: 'active' })

      await processMemberCreateJob(jobData({ jobId: 'mj_abc' }), 1, 3)

      expect(recordMemberJobMemberId).toHaveBeenCalledWith('mj_abc', 'm-1')
    })

    it('a GENUINELY pre-existing member (job row never recorded this member_id -- a fresh job_id, not a retry) still skips welcome as before -- the fix must not weaken D1', async () => {
      vi.mocked(findMemberJobForIntegration).mockResolvedValue({ member_id: null } as never)
      vi.mocked(createOrGetMember).mockResolvedValue({ outcome: 'existing', memberId: 'm-99-already-there', status: 'active' })

      await processMemberCreateJob(jobData(), 1, 3)

      expect(addWelcomeSendJob).not.toHaveBeenCalled()
      expect(completeMemberJobSucceeded).toHaveBeenCalledWith(expect.objectContaining({ welcomeOutcome: 'skipped_existing' }))
    })

    it('a DIFFERENT member_id on the job row than this attempt resolves to -> still skipped_existing (only an EXACT match counts as self-retry)', async () => {
      vi.mocked(findMemberJobForIntegration).mockResolvedValue({ member_id: 'm-other' } as never)
      vi.mocked(createOrGetMember).mockResolvedValue({ outcome: 'existing', memberId: 'm-1', status: 'active' })

      await processMemberCreateJob(jobData(), 2, 3)

      expect(addWelcomeSendJob).not.toHaveBeenCalled()
      expect(completeMemberJobSucceeded).toHaveBeenCalledWith(expect.objectContaining({ welcomeOutcome: 'skipped_existing' }))
    })
  })

  it('template requires a level the request did not assert -> skipped_consent_level with required/effective detail, no welcome-send enqueued', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue({
      snapshot: { newJoinTemplateId: 'tpl-1', consentAttestationText: null, consentAttestationAckAt: null },
    } as never)
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
      id: 'tpl-1',
      restaurantId: 'rest-1',
      category: 'MARKETING',
      status: 'approved',
    } as never)
    // utility opted_in, marketing only pending -> effectiveLevel 'utility', marketing requires 'all'
    vi.mocked(findLatestConsentByCategory).mockImplementation(async ({ category }) =>
      category === 'marketing' ? consentStatus('pending') : consentStatus('opted_in')
    )

    await processMemberCreateJob(jobData({ consentLevel: 'utility' }), 1)

    expect(addWelcomeSendJob).not.toHaveBeenCalled()
    expect(completeMemberJobSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        welcomeOutcome: 'skipped_consent_level',
        welcomeDetail: { required_level: 'all', effective_level: 'utility' },
      })
    )
  })

  it('OD-13: an attestation present AND acknowledged on the integration -> grade strong, consent_text copied from the attestation', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue({
      snapshot: {
        newJoinTemplateId: null,
        consentAttestationText: 'We collect WhatsApp opt-in at checkout.',
        consentAttestationAckAt: '2026-08-01T00:00:00.000Z',
      },
    } as never)

    await processMemberCreateJob(jobData(), 1)

    expect(applyPartnerAssertedConsent).toHaveBeenCalledWith(
      expect.objectContaining({ grade: 'strong', consentText: 'We collect WhatsApp opt-in at checkout.' })
    )
  })

  it('an existing UNSUBSCRIBED member -> welcome skipped_opted_out, never reactivated (OD-2(b) is enforced upstream by the seam; this only proves the welcome gate respects it)', async () => {
    vi.mocked(createOrGetMember).mockResolvedValue({ outcome: 'existing', memberId: 'm-3', status: 'unsubscribed' })
    vi.mocked(findIntegrationSettingsById).mockResolvedValue({
      snapshot: { newJoinTemplateId: 'default', consentAttestationText: null, consentAttestationAckAt: null },
    } as never)

    await processMemberCreateJob(jobData(), 1)

    // memberOutcome 'existing' already short-circuits to skipped_existing --
    // this proves that happens BEFORE the unsubscribed/template checks ever run.
    expect(completeMemberJobSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ welcomeOutcome: 'skipped_existing' })
    )
  })

  it('depth counter is NOT released on a non-final transient failure (job will retry and stay counted)', async () => {
    const limiter = {
      takeToken: vi.fn(),
      incrWindow: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
      incr: vi.fn(),
      decr: vi.fn().mockResolvedValue(0),
      get: vi.fn(),
    }
    vi.mocked(getInboundRateLimiter).mockReturnValue(limiter as never)
    vi.mocked(createOrGetMember).mockRejectedValue(new Error('db timeout'))

    await expect(processMemberCreateJob(jobData(), 1, 3)).rejects.toThrow()

    expect(limiter.decr).not.toHaveBeenCalled()
  })
})
