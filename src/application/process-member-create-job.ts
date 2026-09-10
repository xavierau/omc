// INT-001 WI-3: the `member-create` job worker (plan §"Member-create job
// (worker)"). Everything the route deliberately does NOT do lives here --
// the seam call, consent writes, the legacy `join` event, and the welcome
// DECISION (never the send -- WI-4 owns that). Runs OUTSIDE the request
// path, so a slow tenant lookup or a Redis round-trip here never blocks a
// partner's `202`.

import { UnrecoverableError } from 'bullmq'
import type { ConsentStatus } from '@/domain/value-objects/consent-status'
import type { PartnerConsentCategory } from '@/domain/value-objects/consent-level'
import { effectiveLevel as computeEffectiveLevel } from '@/domain/value-objects/consent-level'
import { E164Phone } from '@/domain/value-objects/e164-phone'
import type { Restaurant } from '@/domain/entities/restaurant'
import { isTenantAccessible } from '@/domain/services/trial-status'
import { isTemplateSendable } from '@/domain/entities/whatsapp-template'

import { createOrGetMember } from './create-or-get-member'
import { decideWelcome, type TemplateResolution, type WelcomeDecision } from './decide-welcome'
import { emitEvent } from './emit-event'

import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { getRestaurantTenantStatus, getRestaurantName } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { isTenantAutoPaused } from '@/infrastructure/supabase/repositories/tenant-trust-queries'
import {
  applyPartnerAssertedConsent,
  findLatestConsentByCategory,
} from '@/infrastructure/supabase/repositories/consent-record-repository'
import { upsertIntegrationMemberRef } from '@/infrastructure/supabase/repositories/integration-member-ref-repository'
import {
  getOnboardingSettings,
  getRestaurantDefaultLanguage,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { getCampaignByIdForRestaurant } from '@/infrastructure/supabase/repositories/campaign-repository'
import { findTemplateByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import {
  markMemberJobProcessing,
  completeMemberJobSucceeded,
  completeMemberJobFailed,
  findMemberJobForIntegration,
  recordMemberJobMemberId,
} from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import { addWelcomeSendJob, getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { notifyOpsAlert } from './notify-ops-alert'
import type { MemberCreateJobData } from '@/infrastructure/queue/integration-inbound-queue'

const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000
const DEFAULT_WELCOME_HOURLY_CAP = 60

// I-3 (defense in depth): matches an E.164-shaped run of digits anywhere in
// a caught error's message and replaces it with a last4-only marker --
// see the catch block below for why.
const E164_LIKE = /\+[1-9]\d{7,14}/g
function redactPhoneLike(message: string): string {
  return message.replace(E164_LIKE, (match) => `***${match.slice(-4)}`)
}

function welcomeHourlyCapFromEnv(): number {
  const raw = process.env.INT001_WELCOME_HOURLY_CAP
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WELCOME_HOURLY_CAP
}

function welcomeHourlyCapKey(restaurantId: string, now: Date): string {
  const yyyymmddhh =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0') +
    String(now.getUTCHours()).padStart(2, '0')
  return `int001:welcome:${restaurantId}:${yyyymmddhh}`
}

function depthCounterKey(integrationId: string): string {
  return `int001:depth:${integrationId}`
}

type PermanentReason = 'tenant_inactive' | 'integration_paused'

class PermanentJobFailure extends Error {
  constructor(public readonly code: PermanentReason) {
    super(code)
    this.name = 'PermanentJobFailure'
  }
}

async function assertTenantAndIntegrationActive(data: MemberCreateJobData): Promise<void> {
  const integration = await findPosIntegrationById(data.integrationId)
  if (!integration || integration.status !== 'active') {
    throw new PermanentJobFailure('integration_paused')
  }

  const tenantStatus = await getRestaurantTenantStatus(data.restaurantId)
  const accessible =
    tenantStatus !== null &&
    isTenantAccessible({ status: tenantStatus.status, trialExpiresAt: tenantStatus.trialExpiresAt } as Restaurant)
  if (!accessible) {
    throw new PermanentJobFailure('tenant_inactive')
  }
}

interface ConsentWriteResult {
  actions: Record<PartnerConsentCategory, string>
  statuses: Record<PartnerConsentCategory, ConsentStatus | null>
}

/** §Consent invariant: one `applyPartnerAssertedConsent` call per category,
 * then a fresh read of the resulting latest status -- `applyPartnerAssertedConsent`
 * returns only the ACTION (inserted/upgraded/noop/blocked_opted_out), and
 * 'noop' alone doesn't say whether the prior row was already opted_in or
 * still pending, both of which `decideWelcome`'s consent-level gate needs
 * to tell apart. */
async function writeConsent(
  data: MemberCreateJobData,
  memberId: string,
  grade: 'strong' | 'weak',
  consentText: string | null,
  businessNameShown: string | null
): Promise<ConsentWriteResult> {
  const categories: PartnerConsentCategory[] = ['utility', 'marketing']
  const actions = {} as Record<PartnerConsentCategory, string>
  const statuses = {} as Record<PartnerConsentCategory, ConsentStatus | null>

  for (const category of categories) {
    actions[category] = await applyPartnerAssertedConsent({
      restaurantId: data.restaurantId,
      phoneE164: data.phoneE164,
      memberId,
      category,
      assertedLevel: data.consentLevel,
      integrationId: data.integrationId,
      grade,
      consentText,
      businessNameShown,
    })
    const latest = await findLatestConsentByCategory({
      restaurantId: data.restaurantId,
      phoneE164: data.phoneE164,
      category,
    })
    statuses[category] = latest?.snapshot.status ?? null
  }

  return { actions, statuses }
}

/** Resolves `new_join_template_id` to a real, tenant-owned, APPROVED
 * template. `'default'` -> onboarding `welcomeCampaignId` -> campaign
 * `whatsappTemplateId` -> `findByIdForRestaurant`; a uuid ->
 * `findByIdForRestaurant` directly. Every miss (no mapping, foreign
 * template, not approved) collapses to `{ found: false }` -- `decideWelcome`
 * treats them all as `skipped_no_template` (spec doesn't distinguish them
 * to the partner or the owner beyond that one reason). WI-4's send-time
 * `resolve-integration-welcome-template.ts` re-implements this SAME rule
 * (T-M11: send-time re-check, not a shared call, so a rename after create
 * but before send is re-evaluated fresh).
 */
async function resolveWelcomeTemplate(
  newJoinTemplateId: string,
  restaurantId: string
): Promise<TemplateResolution> {
  let templateId = newJoinTemplateId
  if (newJoinTemplateId === 'default') {
    const settings = await getOnboardingSettings(restaurantId).catch(() => null)
    if (!settings?.welcomeCampaignId) return { found: false }
    const campaign = await getCampaignByIdForRestaurant(settings.welcomeCampaignId, restaurantId).catch(() => null)
    if (!campaign?.whatsappTemplateId) return { found: false }
    templateId = campaign.whatsappTemplateId
  }

  const template = await findTemplateByIdForRestaurant(templateId, restaurantId)
  if (!template || !isTemplateSendable(template)) return { found: false }
  return { found: true, templateId: template.id, category: template.category }
}

interface WelcomeStepResult {
  decision: WelcomeDecision
}

async function decideAndEnqueueWelcome(
  data: MemberCreateJobData,
  memberOutcome: 'created' | 'existing',
  memberStatus: 'active' | 'unsubscribed',
  consent: ConsentWriteResult,
  createJobId: string,
  memberId: string,
  now: Date
): Promise<WelcomeStepResult> {
  const settings = await findIntegrationSettingsById(data.integrationId)
  const newJoinTemplateId = settings?.snapshot.newJoinTemplateId ?? null

  const template: TemplateResolution =
    newJoinTemplateId === null ? { found: false } : await resolveWelcomeTemplate(newJoinTemplateId, data.restaurantId)

  const categoryStatus =
    template.found ? consent.statuses[template.category === 'MARKETING' ? 'marketing' : 'utility'] : null
  const effectiveLevel = computeEffectiveLevel(consent.statuses.utility, consent.statuses.marketing)
  const tenantAutoPaused = await isTenantAutoPaused(data.restaurantId)

  // Provisional decision assuming the hourly cap has room -- avoids
  // touching (and TTL-refreshing) the Redis counter for a request that was
  // always going to skip for an earlier reason (member-level, template,
  // consent, or quality-pause gates).
  const provisional = decideWelcome({
    memberOutcome,
    sendWelcomeRequested: data.sendWelcome,
    newJoinTemplateId,
    memberStatus,
    template,
    categoryStatus,
    effectiveLevel,
    tenantAutoPaused,
    hourlyCapExceeded: false,
  })

  if (provisional.outcome !== 'queued') {
    return { decision: provisional }
  }

  const limiter = getInboundRateLimiter()
  const { allowed } = await limiter.incrWindow(welcomeHourlyCapKey(data.restaurantId, now), welcomeHourlyCapFromEnv(), 3600)
  if (!allowed) {
    return { decision: { outcome: 'skipped_rate_capped' } }
  }

  await addWelcomeSendJob(`wel:${memberId}:${createJobId}`, {
    memberId,
    restaurantId: data.restaurantId,
    integrationId: data.integrationId,
    createJobId,
  })
  return { decision: provisional }
}

function welcomeDetailFor(decision: WelcomeDecision): Record<string, unknown> | null {
  if (decision.outcome === 'skipped_consent_level') {
    return { required_level: decision.requiredLevel, effective_level: decision.effectiveLevel }
  }
  return null
}

async function finalizeFailure(jobId: string, code: string, message: string, now: Date): Promise<void> {
  await completeMemberJobFailed({
    jobId,
    errorCode: code,
    errorMessage: message,
    completedAt: now.toISOString(),
    resultExpiresAt: new Date(now.getTime() + RESULT_RETENTION_MS).toISOString(),
  })
}

async function releaseDepthCounter(integrationId: string): Promise<void> {
  try {
    await getInboundRateLimiter().decr(depthCounterKey(integrationId))
  } catch (err) {
    console.error('[ProcessMemberCreateJob] depth counter release failed', {
      integrationId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function processMemberCreateJob(
  data: MemberCreateJobData,
  attemptNumber: number,
  maxAttempts = 3
): Promise<void> {
  const now = new Date()
  await markMemberJobProcessing(data.jobId, now.toISOString(), attemptNumber)

  const isFinalAttempt = attemptNumber >= maxAttempts
  let terminal = false

  try {
    await assertTenantAndIntegrationActive(data)

    // G-1: capture member_id AS OF THE START of this attempt, before
    // createOrGetMember can possibly change it -- the only way to tell
    // "this attempt's own createOrGetMember found the SAME member an
    // earlier, uncommitted attempt of THIS job already created" apart from
    // "this member genuinely pre-existed before this job ever ran".
    const jobBefore = await findMemberJobForIntegration(data.jobId, data.integrationId)

    const language = data.language ?? (await getRestaurantDefaultLanguage(data.restaurantId))
    const createResult = await createOrGetMember({
      restaurantId: data.restaurantId,
      phoneE164: E164Phone.of(data.phoneE164),
      name: data.name,
      preferredLanguage: language,
      source: 'partner_api',
      originIntegrationId: data.integrationId,
    })

    // G-1: record it immediately -- BEFORE completeMemberJobSucceeded --
    // so a crash/retry between here and there can recognise its own prior
    // write instead of treating it as a genuinely pre-existing member and
    // silently skipping the welcome (decideWelcome's D1 rule).
    if (createResult.outcome === 'created') {
      await recordMemberJobMemberId(data.jobId, createResult.memberId)
    }
    const createdByThisJob = jobBefore !== null && jobBefore.member_id === createResult.memberId
    const welcomeMemberOutcome: 'created' | 'existing' =
      createResult.outcome === 'created' || createdByThisJob ? 'created' : 'existing'

    const settings = await findIntegrationSettingsById(data.integrationId)
    const attestationText = settings?.snapshot.consentAttestationText ?? null
    const attestationAcked = settings?.snapshot.consentAttestationAckAt !== null && settings?.snapshot.consentAttestationAckAt !== undefined
    const grade: 'strong' | 'weak' = attestationText && attestationAcked ? 'strong' : 'weak'
    const consentText = grade === 'strong' ? attestationText : null
    const businessNameShown = await getRestaurantName(data.restaurantId).catch(() => null)

    const consent = await writeConsent(data, createResult.memberId, grade, consentText, businessNameShown)

    if (data.externalRef) {
      await upsertIntegrationMemberRef({
        memberId: createResult.memberId,
        integrationId: data.integrationId,
        externalRef: data.externalRef,
      })
    }

    if (createResult.outcome === 'created') {
      await emitEvent({
        restaurantId: data.restaurantId,
        memberId: createResult.memberId,
        type: 'join',
        dataJson: { source: 'partner_api', integration_id: data.integrationId },
        source: `pos:${data.integrationId}`,
      })
    }

    const { decision } = await decideAndEnqueueWelcome(
      data,
      welcomeMemberOutcome,
      createResult.status,
      consent,
      data.jobId,
      createResult.memberId,
      now
    )

    terminal = true
    await completeMemberJobSucceeded({
      jobId: data.jobId,
      outcome: createResult.outcome,
      memberId: createResult.memberId,
      consentActions: consent.actions,
      welcomeOutcome: decision.outcome,
      welcomeDetail: welcomeDetailFor(decision),
      completedAt: new Date().toISOString(),
      resultExpiresAt: new Date(Date.now() + RESULT_RETENTION_MS).toISOString(),
    })
  } catch (err) {
    if (err instanceof PermanentJobFailure) {
      terminal = true
      await finalizeFailure(data.jobId, err.code, err.message, new Date())
      throw new UnrecoverableError(`member-create permanently failed (${err.code}): ${data.jobId}`)
    }

    // I-3 (defense in depth): the primary fix is at the source
    // (consent-record-repository.ts no longer embeds the full phone in a
    // ConsentImportError, and applyPartnerAssertedConsent's race no longer
    // throws at all -- see that file's own I-3 comments). This is a second
    // layer: ANY thrown error's message reaching this catch is redacted
    // before it becomes the job row's error_message, the Slack alert, or
    // the re-thrown error the worker's `.on('failed')` handler logs
    // (T-H7's "no PII in job row/Slack/logs" invariant, applied generally
    // rather than only to the one known case).
    const message = redactPhoneLike(err instanceof Error ? err.message : String(err))
    if (isFinalAttempt) {
      terminal = true
      await finalizeFailure(data.jobId, 'internal', message, new Date())
      await notifyOpsAlert({
        kind: 'engineering_alert',
        severity: 'error',
        restaurantId: data.restaurantId,
        message: `INT-001 member-create job exhausted retries: ${data.jobId}`,
        details: { integrationId: data.integrationId, jobId: data.jobId, error: message },
      }).catch(() => {})
    }
    throw new Error(`processMemberCreateJob: ${message}`)
  } finally {
    if (terminal) {
      await releaseDepthCounter(data.integrationId)
    }
  }
}
