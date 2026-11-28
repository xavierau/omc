// INT-001 WI-4: the `welcome-send` job worker (plan §"Welcome-send job
// (OD-15, T-M11, T-H8)"). WI-3 enqueues this job from a PROVISIONAL
// decision made at create time; this file is the one that actually mints
// (OD-15) and sends. Every gate WI-3 already checked is re-run here from
// FRESH reads -- never trusted from the create-time job payload, which
// carries only `{ memberId, restaurantId, integrationId, createJobId }` and
// nothing else (T-H7's ids-only discipline applies to this queue too).
//
// Re-uses `decideWelcome` (WI-3's own frozen pure function) with fresh
// inputs rather than re-implementing its evaluation order -- the exact
// same outcome vocabulary and `skipped_consent_level` detail shape the
// create-time job already produces, so a send-time skip is indistinguishable
// in shape from a create-time skip on the delivery log / member timeline.

import type { WelcomeSendJobData } from '@/infrastructure/queue/integration-inbound-queue'
import { getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { findMemberForOutboundPayload } from '@/infrastructure/supabase/repositories/integration-outbound-member-repository'
import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { findLatestConsentByCategory } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { isTenantAutoPaused } from '@/infrastructure/supabase/repositories/tenant-trust-queries'
import {
  findMemberJobForIntegration,
  updateMemberJobWelcomeOutcome,
} from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { effectiveLevel as computeEffectiveLevel } from '@/domain/value-objects/consent-level'
import type { TemplateCategory } from '@/domain/entities/whatsapp-template'
import type { MessageCategory } from '@/domain/entities/whatsapp-message'

import { decideWelcome, type TemplateResolution, type WelcomeDecision } from './decide-welcome'
import { resolveIntegrationWelcomeTemplate } from './resolve-integration-welcome-template'
import { mintWelcomeCouponIdempotent } from './mint-welcome-coupon-idempotent'
import { recordOutboundSend } from './record-outbound-send'
import { sendWhatsAppTemplateMessage } from './send-template-message'
import { isMessageTrackingEnabled } from './message-tracking-flag'
import { formatDiscount } from './execute-campaign-coupon'
import { notifyOpsAlert } from './notify-ops-alert'

const DEFAULT_WELCOME_HOURLY_CAP = 60

// Deliberately a SEPARATE Redis key namespace from WI-3's create-time
// `int001:welcome:{restaurantId}:{yyyymmddhh}` counter (`process-member-
// create-job.ts`), not the same one re-incremented or read here. WI-3's
// counter gates whether a welcome-send job is worth enqueuing AT ALL and
// increments only when its OWN provisional decision is `queued` (every
// earlier gate -- member-level, template, consent, quality-pause --
// already passed) -- reading it here would see a count that has already
// filtered out every request that was never going to send anyway, so it
// can't distinguish "capped" from "never would have queued." Incrementing
// IT again here would silently halve the real budget (one unit at
// enqueue, a second at send, for the same welcome). A dedicated counter
// that increments ONLY on an actual, about-to-send attempt is the
// only one that correctly enforces "<= N sends per tenant per hour"
// independent of how many creates arrived -- a deliberate, disclosed
// design choice, not a literal copy of WI-3's key.
function welcomeHourlyCapFromEnv(): number {
  const raw = process.env.INT001_WELCOME_HOURLY_CAP
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WELCOME_HOURLY_CAP
}

function welcomeSentCapKey(restaurantId: string, now: Date): string {
  const yyyymmddhh =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0') +
    String(now.getUTCHours()).padStart(2, '0')
  return `int001:welcome:sent:${restaurantId}:${yyyymmddhh}`
}

function toMessageCategory(category: TemplateCategory): MessageCategory {
  return category === 'MARKETING' ? 'marketing' : 'utility'
}

function welcomeDetailFor(decision: WelcomeDecision): Record<string, unknown> | null {
  if (decision.outcome === 'skipped_consent_level') {
    return { required_level: decision.requiredLevel, effective_level: decision.effectiveLevel }
  }
  return null
}

export async function processWelcomeSendJob(
  data: WelcomeSendJobData,
  attemptNumber: number,
  maxAttempts = 3
): Promise<void> {
  const isFinalAttempt = attemptNumber >= maxAttempts

  // I-5: a retry after a successful send (recordOutboundSend succeeds, then
  // the `sent` write below throws or the worker dies before it runs) used
  // to re-run every gate and send a SECOND template message -- the coupon
  // mint is idempotent (OD-15) but the send itself is not, and each retry
  // also burns another hourly-cap token. Short-circuit here, before any
  // gate/mint/send, if a prior attempt already persisted `sent`. This does
  // NOT close the narrower window where the send succeeded but THIS write
  // never landed (no outcome was ever persisted to detect) -- that would
  // need an idempotency key at the WhatsApp-send layer itself; out of
  // scope for this fix, see the hand-off artifact.
  const existingJob = await findMemberJobForIntegration(data.createJobId, data.integrationId)
  if (existingJob?.welcome_outcome === 'sent') {
    return
  }

  // A genuinely deleted member (not covered by decideWelcome's `'active' |
  // 'unsubscribed'` input -- there is no "missing" member status) is the
  // one gate decideWelcome cannot express. No phone to send to, no point
  // retrying: skip and complete, never throw.
  const member = await findMemberForOutboundPayload(data.memberId)
  if (!member || member.restaurantId !== data.restaurantId) {
    await updateMemberJobWelcomeOutcome(data.createJobId, 'skipped_member_missing', null)
    return
  }

  const integration = await findPosIntegrationById(data.integrationId)
  const integrationActive = integration !== null && integration.status === 'active'
  const settings = integrationActive ? await findIntegrationSettingsById(data.integrationId) : null
  // An integration paused/deleted since create-time collapses to the same
  // `skipped_off` bucket decideWelcome already has for "welcome off" --
  // there is no separate reason code for it, and none is needed: both mean
  // "nothing to send for this integration right now."
  const newJoinTemplateId = integrationActive ? (settings?.snapshot.newJoinTemplateId ?? null) : null

  const resolution =
    newJoinTemplateId === null
      ? ({ found: false } as const)
      : await resolveIntegrationWelcomeTemplate(newJoinTemplateId, data.restaurantId)

  const templateInput: TemplateResolution = resolution.found
    ? { found: true, templateId: resolution.template.id, category: resolution.template.category }
    : { found: false }

  const category = resolution.found ? toMessageCategory(resolution.template.category) : null

  const [utilityConsent, marketingConsent] = await Promise.all([
    findLatestConsentByCategory({ restaurantId: data.restaurantId, phoneE164: member.phone, category: 'utility' }),
    findLatestConsentByCategory({ restaurantId: data.restaurantId, phoneE164: member.phone, category: 'marketing' }),
  ])
  const utilityStatus = utilityConsent?.snapshot.status ?? null
  const marketingStatus = marketingConsent?.snapshot.status ?? null
  const effectiveLevelNow = computeEffectiveLevel(utilityStatus, marketingStatus)
  const categoryStatus = category === 'marketing' ? marketingStatus : category === 'utility' ? utilityStatus : null

  const tenantAutoPaused = await isTenantAutoPaused(data.restaurantId)

  // Provisional, like WI-3's own enqueue-time call: avoids consuming (and
  // TTL-refreshing) the hourly-sent counter for a job that was always going
  // to skip for an earlier reason.
  const provisional = decideWelcome({
    memberOutcome: 'created',
    sendWelcomeRequested: true,
    newJoinTemplateId,
    memberStatus: member.status,
    template: templateInput,
    categoryStatus,
    effectiveLevel: effectiveLevelNow,
    tenantAutoPaused,
    hourlyCapExceeded: false,
  })

  let decision: WelcomeDecision = provisional
  if (provisional.outcome === 'queued') {
    const limiter = getInboundRateLimiter()
    const { allowed } = await limiter.incrWindow(
      welcomeSentCapKey(data.restaurantId, new Date()),
      welcomeHourlyCapFromEnv(),
      3600
    )
    if (!allowed) {
      decision = { outcome: 'skipped_rate_capped' }
    }
  }

  if (decision.outcome !== 'queued' || !resolution.found) {
    await updateMemberJobWelcomeOutcome(data.createJobId, decision.outcome, welcomeDetailFor(decision))
    return
  }

  const coupon = await mintWelcomeCouponIdempotent(data.restaurantId, member.id, member.name ?? '', resolution.campaign)

  const phoneNumberId = await getRestaurantPhoneNumberId(data.restaurantId)
  const result = await recordOutboundSend({
    restaurantId: data.restaurantId,
    memberId: member.id,
    campaignId: resolution.campaign?.id ?? null,
    phoneE164: member.phone,
    category: toMessageCategory(resolution.template.category),
    messageType: 'template',
    // T-M3-style hygiene sibling: `whatsapp_messages` has no `source`
    // column (shared hot-path table) -- this prefix plus
    // `welcome_detail.whatsapp_message_id` (below) is the discriminator
    // that lets the delivery log / member timeline tell a partner-API
    // welcome apart from a campaign or onboarding send.
    contentPreview: `[welcome_partner_api] ${resolution.template.name}`,
    template: { id: resolution.template.id, name: resolution.template.name },
    trackingEnabled: isMessageTrackingEnabled(),
    send: () =>
      sendWhatsAppTemplateMessage({
        phoneNumberId,
        to: member.phone,
        template: resolution.template,
        paramValues: {
          customer_name: member.name ?? 'there',
          code: coupon.code,
          discount: formatDiscount(resolution.campaign?.couponConfig ?? null),
        },
        couponCode: coupon.code,
      }),
  })

  if (!result.ok) {
    if (isFinalAttempt) {
      // The coupon is already idempotent (mint above) -- a further retry
      // after this would just re-attempt the same send, never re-mint.
      await updateMemberJobWelcomeOutcome(data.createJobId, 'failed', null)
      await notifyOpsAlert({
        kind: 'engineering_alert',
        severity: 'error',
        restaurantId: data.restaurantId,
        message: `INT-001 welcome-send job exhausted retries: ${data.createJobId}`,
        details: {
          integrationId: data.integrationId,
          memberId: data.memberId,
          error: result.error?.title ?? 'send_failed',
        },
      }).catch(() => {})
    }
    throw new Error(`processWelcomeSendJob: send failed (${result.error?.title ?? 'unknown'})`)
  }

  await updateMemberJobWelcomeOutcome(data.createJobId, 'sent', { whatsapp_message_id: result.kapsoMessageId })
}
