import {
  getCampaignById,
  updateCampaign,
  transitionCampaignStatus,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { Campaign } from '@/domain/entities/campaign'
import { Language } from '@/domain/value-objects/language'
import { resolveTargetMembers } from './resolve-campaign-members'
import { resolveCampaignTemplate } from './resolve-campaign-template'
import { resolveWhatsAppTemplate } from './resolve-whatsapp-template'
import { enforceCampaignGuardrails } from './enforce-campaign-guardrails'
import { enforceTemplateReview } from './enforce-template-review'
import { enforceHeaderMedia } from './enforce-header-media'
import { NoTemplateError } from './no-template-error'
import { sendInBatches, type SendContext } from './execute-campaign-batch'
import type { SkipCounters } from './execute-campaign-batch-counters'
import { getSettingsForTenant } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import {
  DEFAULT_PER_USER_MARKETING_CAP,
  type TenantCampaignSettings,
} from '@/domain/services/campaign-guardrails'
import {
  DEFAULT_PACING_CONFIG,
  type PacingConfig,
} from '@/domain/value-objects/pacing-strategy'

export async function executeCampaign(
  campaignId: string,
  restaurantId: string
): Promise<void> {
  const campaign = await getCampaignById(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)
  if (campaign.type === 'welcome') {
    throw new Error('Welcome campaigns are triggered on member join')
  }

  const members = await resolveTargetMembers(campaign, restaurantId)
  const activeMembers = members.filter((m) => m.status !== 'unsubscribed')
  await enforceCampaignGuardrails(restaurantId, activeMembers.length)

  // Resolve template up-front so we fail fast (status unchanged) on a
  // misconfigured campaign — no state churn, no revert required.
  const template = await resolveWhatsAppTemplate(campaign)
  assertHasAnyInlineTemplate(campaign, template)
  // WAQ-011: untrusted tenants need an approved review row for MARKETING.
  await enforceTemplateReview({ campaign, restaurantId, template })
  // #127 / CAMP-007: a media-header template with no usable stored URL is a
  // guaranteed Meta #132012 on every send — fail fast (status untouched)
  // instead of burning the run.
  enforceHeaderMedia(template)

  const claimed = await transitionCampaignStatus(campaignId, 'active', 'sending')
  if (!claimed) throw new Error(`Campaign ${campaignId} not active or already processing`)

  try {
    const ctx = await buildSendContext(campaign, restaurantId, template)
    const counters = await sendInBatches(activeMembers, ctx)
    await finalizeCampaignRun(campaignId, counters, template)
  } catch (err) {
    await updateCampaign(campaignId, { status: 'active' })
    throw err
  }
}

// #127 / CAMP-007: an all-failed run must not read `completed` — the prod
// incident showed 2/2 Meta rejections as a completed campaign with 0 sent
// and no failure_reason. Terminal `failed` + reason (not a throw): a throw
// would revert to `active` and burn 3 blind BullMQ retries on what is
// almost always a deterministic template mismatch; the operator can revive
// via PATCH once the template is fixed (the revival guard clears the
// reason). Skips don't count as failures, so an all-skipped run (e.g. no
// consent) still completes as before. The reason is tenant-visible: fixed
// wording only, never raw send-error internals — and it names the deciding
// system (template vs connection vs unknown), never a look-alike.
async function finalizeCampaignRun(
  campaignId: string,
  counters: SkipCounters,
  template: WhatsAppTemplate | null
): Promise<void> {
  const nothingSent = counters.sent === 0
  const anyBroken = counters.failed > 0 || counters.errored > 0
  if (!nothingSent || !anyBroken) {
    await updateCampaign(campaignId, { status: 'completed' })
    return
  }
  await updateCampaign(campaignId, {
    status: 'failed',
    failureReason: totalFailureReason(counters, template),
  })
}

// Wording deliberately names no revival mechanism: the dashboard has no
// status control for failed campaigns (review #127, follow-up #129) —
// reactivation is an operator PATCH today.
function totalFailureReason(
  counters: SkipCounters,
  template: WhatsAppTemplate | null
): string {
  // Any `errored` member means delivery is UNKNOWN (the send may have gone
  // out before bookkeeping broke) — never claim "all sends failed", and warn
  // against a blind re-run that would double-send.
  if (counters.errored > 0) {
    const broken = counters.failed + counters.errored
    return (
      `${broken} message sends did not complete and delivery could not be ` +
      `confirmed for ${counters.errored} of them. Contact support before ` +
      're-running this campaign.'
    )
  }
  if (template) {
    return (
      `All ${counters.failed} message sends failed. Check that the ` +
      "campaign's WhatsApp template still matches its approved definition " +
      '(including any media header) before retrying.'
    )
  }
  return (
    `All ${counters.failed} message sends failed. Check that WhatsApp is ` +
    'connected for this restaurant before retrying.'
  )
}

async function buildSendContext(
  campaign: Campaign,
  restaurantId: string,
  template: WhatsAppTemplate | null
): Promise<SendContext> {
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  const restaurantDefaultLanguage = await getRestaurantDefaultLanguage(
    restaurantId
  )
  // Capture the tracking flag ONCE per campaign run so an env-flip
  // mid-batch doesn't orphan in-flight queued rows.
  const trackingEnabled = process.env.WAQ_TRACK_MESSAGES === '1'
  // Same pattern for WAQ-007 cooldown cap + WAQ-010 pacing — read once.
  const settings = await getSettingsForTenant(restaurantId)
  const perUserMarketingCap =
    settings?.perUserMarketingCap ?? DEFAULT_PER_USER_MARKETING_CAP
  return {
    campaign,
    phoneNumberId,
    template,
    restaurantDefaultLanguage,
    trackingEnabled,
    perUserMarketingCap,
    pacingConfig: pacingConfigFrom(settings),
  }
}

// WAQ-010: snapshot pacing so a mid-batch tenant-settings update can't
// re-chunk an in-flight run. `settings` is null only on a missing row.
function pacingConfigFrom(
  settings: TenantCampaignSettings | null
): PacingConfig {
  if (!settings) return DEFAULT_PACING_CONFIG
  return {
    strategy: settings.pacingStrategy,
    probeChunkSize: settings.probeChunkSize,
    scaleChunkSize: settings.scaleChunkSize,
    activeHoursStartLocal: settings.activeHoursStartLocal,
    activeHoursEndLocal: settings.activeHoursEndLocal,
    tenantTimezone: settings.tenantTimezone,
  }
}

function assertHasAnyInlineTemplate(
  campaign: Campaign,
  template: WhatsAppTemplate | null
): void {
  if (template) return
  const hasEn = resolveCampaignTemplate(campaign, Language.EN) !== null
  const hasZh = resolveCampaignTemplate(campaign, Language.ZH_HK) !== null
  if (!hasEn && !hasZh) throw new NoTemplateError(campaign.id)
}

export { CampaignGuardrailError } from './campaign-guardrail-error'
export { NoTemplateError } from './no-template-error'
