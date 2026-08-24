// Per-recipient broadcast pipeline. Extracted from execute-campaign-batch.ts
// (WAQ-010) so the batch orchestrator stays under the file-size limit.
//
// Responsibility: take an allowed member + send context and dispatch by
// template shape (CAMP-001). Claim mode sends only the claim-button template;
// eager mode sends the body FIRST, then mints the coupon + QR. Either way the
// counter increment + campaign event happen ONLY on send success. A failed
// send throws so the orchestrator tallies it via `Promise.allSettled`.

import { incrementCampaignSent } from '@/infrastructure/supabase/repositories/campaign-repository'
import { isCouponUniqueViolation } from '@/infrastructure/supabase/repositories/coupon-error'
import { emitEvent } from '@/application/emit-event'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/services/template-renderer'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { resolveCampaignTemplate } from './resolve-campaign-template'
import { SendFailedError } from './send-failed-error'
import {
  createCampaignBroadcastCoupon,
  formatDiscount,
} from './execute-campaign-coupon'
import {
  sendCampaignBody,
  sendClaimBody,
  sendCouponQr,
} from './execute-campaign-send'
import type { Campaign } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { SendResult } from '@/domain/value-objects/send-result'
import type { SendContext } from './execute-campaign-batch'

// Re-uses the orchestrator's SendContext rather than introducing a parallel
// shape — sendCampaignBody / sendCouponQr already type-check against it.
//
// CAMP-001: branch on template shape. Claim mode (template has a QUICK_REPLY
// button) sends ONLY the claim-button template — the coupon + QR are minted
// lazily when the customer taps claim. Eager mode preserves the legacy inline
// text / URL-button + coupon + QR flow, reordered so the body is sent FIRST
// and side effects only happen on send success.
export async function sendToMember(
  member: Member,
  ctx: SendContext
): Promise<void> {
  if (isClaimTemplate(ctx.template)) {
    return sendClaimToMember(member, ctx)
  }
  return sendEagerToMember(member, ctx)
}

function isClaimTemplate(template: WhatsAppTemplate | null): boolean {
  if (!template) return false
  const buttonsComponent = template.components.find((c) => c.type === 'BUTTONS')
  return Boolean(
    buttonsComponent?.buttons?.some((b) => b.type === 'QUICK_REPLY')
  )
}

async function sendClaimToMember(
  member: Member,
  ctx: SendContext
): Promise<void> {
  const result = await sendClaimBody(member, ctx)
  throwIfNotOk(result, 'claim')
  await incrementCampaignSent(ctx.campaign.id, ctx.campaign.isChargeable)
  await emitEvent({
    restaurantId: ctx.campaign.restaurantId,
    memberId: member.id,
    type: 'campaign',
    dataJson: { campaignId: ctx.campaign.id },
  })
}

async function sendEagerToMember(
  member: Member,
  ctx: SendContext
): Promise<void> {
  const code = generateCouponCode()
  const couponDescription = buildCouponDescription(member, ctx, code)
  const result = await sendCampaignBody(member, ctx, code, couponDescription)
  throwIfNotOk(result, 'campaign')
  if (!(await mintEagerCoupon(member, ctx, code, couponDescription))) return
  await sendCouponQr(member, ctx, code)
  await incrementCampaignSent(ctx.campaign.id, ctx.campaign.isChargeable)
  await emitEvent({
    restaurantId: ctx.campaign.restaurantId,
    memberId: member.id,
    type: 'campaign',
    dataJson: { campaignId: ctx.campaign.id, couponCode: code },
  })
}

// A campaign re-executed after a partial failure (status reverts sending→active)
// re-processes already-minted members. Migration 053's unique index makes that
// re-mint raise 23505; tolerate it and skip the rest so a retry neither throws
// (tallying the member `failed`) nor double-counts — the member already holds
// their coupon + QR from the first run. Returns false when the coupon existed.
async function mintEagerCoupon(
  member: Member,
  ctx: SendContext,
  code: string,
  description: string
): Promise<boolean> {
  try {
    await createCampaignBroadcastCoupon(ctx.campaign, member, code, description)
    return true
  } catch (err) {
    if (!isCouponUniqueViolation(err)) throw err
    console.warn('[Campaign] eager coupon already exists (retry) — skipping', {
      campaignId: ctx.campaign.id,
      memberId: member.id,
    })
    return false
  }
}

// Throwing is the observability mechanism: Promise.allSettled in the batch
// tallies it as `failed` and recordOutboundSend has already persisted a failed
// whatsapp_messages row (when tracking is on). No counter increment / event.
// Typed (#127): `tally` counts ONLY this class as a send failure — any other
// rejection in the member pipeline lands in `errored` so a delivered-but-
// bookkeeping-broken run can't be terminally marked "all sends failed".
function throwIfNotOk(result: SendResult, mode: string): void {
  if (result.ok) return
  throw new SendFailedError(mode, result.error?.title ?? 'unknown')
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
