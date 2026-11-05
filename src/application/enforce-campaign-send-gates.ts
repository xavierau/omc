import type { Campaign } from '@/domain/entities/campaign'
import { enforceCampaignGuardrails } from './enforce-campaign-guardrails'
import { resolveWhatsAppTemplate } from './resolve-whatsapp-template'
import { enforceTemplateReview } from './enforce-template-review'
import { enforceHeaderMedia } from './enforce-header-media'
import { enforceCouponParams } from './enforce-coupon-params'

/**
 * Issue #102 Part A fix 2 + review round 2 item 2: every send-time gate, run
 * synchronously BEFORE enqueueing, in the SAME order executeCampaign does, so
 * a blocked send returns a typed 4xx with the real reason instead of
 * `200 {"status":"queued"}` — previously the real failure only surfaced in the
 * worker log, or (for a TRANSIENT violation like a tenant pause) burned 3 blind
 * retries and permanently failed the campaign. targetMemberCount=0 mirrors the
 * cron's documented optimistic check (see /api/cron/campaigns/route.ts) — the
 * real member count isn't known pre-enqueue, but this still catches pause,
 * daily-limit, and unsubscribe-rate violations immediately.
 *
 * Shared by /execute and /rerun (CAMP-014) so the two cannot drift.
 */
export async function enforceCampaignSendGates(campaign: Campaign): Promise<void> {
  await enforceCampaignGuardrails(campaign.restaurantId, 0)
  // Item 3: loads the same template the worker would, so this can't drift
  // from the actual send-time check.
  const template = await resolveWhatsAppTemplate(campaign)
  await enforceTemplateReview({
    campaign,
    restaurantId: campaign.restaurantId,
    template,
  })
  // #127 / CAMP-007: same order as executeCampaign — a media-header template
  // with no usable stored URL fails every send with #132012.
  enforceHeaderMedia(template)
  enforceCouponParams(campaign, template)
}
