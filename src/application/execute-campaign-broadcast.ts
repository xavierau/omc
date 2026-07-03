// Per-recipient broadcast pipeline. Extracted from execute-campaign-batch.ts
// (WAQ-010) so the batch orchestrator stays under the file-size limit.
//
// Responsibility: take an allowed member + send context, render the
// per-language inline template, mint the coupon, send the body + QR, then
// emit the campaign event. Failures bubble up to the orchestrator which
// tallies them via `Promise.allSettled` — never throw out of this file
// without a clear stack.

import { incrementCampaignSent } from '@/infrastructure/supabase/repositories/campaign-repository'
import { emitEvent } from '@/application/emit-event'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/services/template-renderer'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { resolveCampaignTemplate } from './resolve-campaign-template'
import {
  createCampaignBroadcastCoupon,
  formatDiscount,
} from './execute-campaign-coupon'
import { sendCampaignBody, sendCouponQr } from './execute-campaign-send'
import type { Campaign } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { SendContext } from './execute-campaign-batch'

// Re-uses the orchestrator's SendContext rather than introducing a parallel
// shape — sendCampaignBody / sendCouponQr already type-check against it.
export async function sendToMember(
  member: Member,
  ctx: SendContext
): Promise<void> {
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
