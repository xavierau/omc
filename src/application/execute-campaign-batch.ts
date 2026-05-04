import { incrementCampaignSent } from '@/infrastructure/supabase/repositories/campaign-repository'
import { emitEvent } from '@/application/emit-event'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/services/template-renderer'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { resolveCampaignTemplate } from './resolve-campaign-template'
import { createCampaignBroadcastCoupon, formatDiscount } from './execute-campaign-coupon'
import { sendCampaignBody, sendCouponQr } from './execute-campaign-send'
import { loadMarketingGateDecisions } from './execute-campaign-batch-gate'
import {
  emptyCounters,
  logSummary,
  outcomeFromDecision,
  tally,
  type MemberOutcome,
} from './execute-campaign-batch-counters'
import type { SkipDecision } from '@/domain/value-objects/marketing-skip-reason'
import { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { Campaign } from '@/domain/entities/campaign'
import { Member } from '@/domain/entities/member'

const BATCH_SIZE = 20
const BATCH_DELAY_MS = 1000

export interface SendContext {
  campaign: Campaign
  phoneNumberId: string
  template: WhatsAppTemplate | null
  restaurantDefaultLanguage: string | null
  trackingEnabled: boolean
  // WAQ-007: per-recipient marketing cap. Captured at run-start so a
  // mid-batch tenant_campaign_settings update doesn't change behaviour
  // partway through. Default 1, tenant-overridable up to 10.
  perUserMarketingCap: number
}

export async function sendInBatches(
  members: Member[],
  ctx: SendContext
): Promise<void> {
  const counters = emptyCounters()
  const isMarketing = isMarketingRun(ctx)
  for (let i = 0; i < members.length; i += BATCH_SIZE) {
    const batch = members.slice(i, i + BATCH_SIZE)
    const decisions = isMarketing ? await loadDecisions(batch, ctx) : null
    const results = await Promise.allSettled(
      batch.map((m) => attemptMember(m, ctx, decisions))
    )
    tally(results, counters)
    if (i + BATCH_SIZE < members.length) await delay(BATCH_DELAY_MS)
  }
  logSummary(members.length, counters)
}

async function loadDecisions(
  batch: Member[],
  ctx: SendContext
): Promise<Map<string, SkipDecision>> {
  return loadMarketingGateDecisions({
    restaurantId: ctx.campaign.restaurantId,
    cap: ctx.perUserMarketingCap,
    batch,
  })
}

async function attemptMember(
  member: Member,
  ctx: SendContext,
  decisions: Map<string, SkipDecision> | null
): Promise<MemberOutcome> {
  if (decisions !== null) {
    const outcome = outcomeFromDecision(decisions.get(member.phone))
    if (outcome !== 'allowed') return outcome
  }
  await sendToMember(member, ctx)
  return 'sent'
}

function isMarketingRun(ctx: SendContext): boolean {
  // Only WhatsApp template sends carry a Meta-classified category. Inline
  // text/QR campaigns go out as 'service' and are not gated by marketing
  // consent or per-user cooldown (they are receipt-tied or operational).
  return ctx.template?.category === 'MARKETING'
}

async function sendToMember(member: Member, ctx: SendContext): Promise<void> {
  const code = generateCouponCode()
  const couponDescription = buildCouponDescription(member, ctx, code)
  await createCampaignBroadcastCoupon(ctx.campaign, member, code, couponDescription)
  await sendCampaignBody(member, ctx, code, couponDescription)
  await sendCouponQr(member, ctx, code)
  await incrementCampaignSent(ctx.campaign.id, ctx.campaign.isChargeable)
  await emitEvent({
    restaurantId: ctx.campaign.restaurantId,
    memberId: member.id,
    type: 'campaign',
    dataJson: { campaignId: ctx.campaign.id, couponCode: code },
  })
}

function buildCouponDescription(
  member: Member,
  ctx: SendContext,
  code: string
): string {
  const language = resolvePreferredLanguage(member, {
    defaultLanguage: ctx.restaurantDefaultLanguage,
  })
  const resolvedTemplate = resolveCampaignTemplate(ctx.campaign, language)
  const rendered = renderInline(resolvedTemplate ?? '', ctx.campaign, member, code)
  // Coupon description is what admin dashboards show; avoid empty labels by
  // falling back to the campaign name when the rendered template is blank.
  return rendered.trim().length > 0 ? rendered : ctx.campaign.name ?? ''
}

function renderInline(
  template: string,
  campaign: Campaign,
  member: Member,
  code: string
): string {
  const discount = formatDiscount(campaign.couponConfig)
  return renderTemplate(template, {
    name: member.name ?? 'there',
    code,
    discount,
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
