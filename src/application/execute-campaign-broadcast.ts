// Per-recipient broadcast pipeline. Extracted from execute-campaign-batch.ts
// (WAQ-010) so the batch orchestrator stays under the file-size limit.
//
// Responsibility: take an allowed member + send context and dispatch by
// template shape (CAMP-001) and coupon config (#134). Claim mode sends only
// the claim-button template; eager mode sends the body FIRST, then mints the
// coupon + QR; marketing-only mode (couponConfig null — a plain announcement)
// sends the body with no code and mints nothing. Either way the counter
// increment + campaign event happen ONLY on send success. A failed send
// throws so the orchestrator tallies it via `Promise.allSettled`.

import { incrementCampaignSent } from '@/infrastructure/supabase/repositories/campaign-repository'
import { isCouponUniqueViolation } from '@/infrastructure/supabase/repositories/coupon-error'
import { emitEvent } from '@/application/emit-event'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { isCouponRedeemable, type Coupon } from '@/domain/entities/coupon'
import { isClaimTemplate } from '@/domain/services/campaign-mode'
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
import type { SendResult } from '@/domain/value-objects/send-result'
import type { SendContext } from './execute-campaign-batch'
import type { MemberOutcome } from './execute-campaign-batch-counters'
import { EMPTY_PREFETCH, type RerunPrefetch } from './execute-campaign-rerun-prefetch'

// Re-uses the orchestrator's SendContext rather than introducing a parallel
// shape — sendCampaignBody / sendCouponQr already type-check against it.
//
// CAMP-001: branch on template shape. Claim mode (template has a QUICK_REPLY
// button) sends ONLY the claim-button template — the coupon + QR are minted
// lazily when the customer taps claim. Eager mode preserves the legacy inline
// text / URL-button + coupon + QR flow, reordered so the body is sent FIRST
// and side effects only happen on send success.
//
// #134: claim precedence checked first, then coupon config. A campaign with
// no couponConfig is a plain marketing announcement — marketing-only mode
// sends the body with an empty code and never mints a coupon or QR, even if
// a leftover coupon from a pre-fix run exists for the member (prefetch is
// ignored in this branch).
//
// #131 / CAMP-002: `prefetch` carries the chunk's re-run state. Eager mode
// reuses the promo coupon the member already holds (its code goes in the
// body; no second mint) so a campaign re-run after a Meta-side fix reaches
// the members whose first send was rejected — with the code they can use.
export async function sendToMember(
  member: Member,
  ctx: SendContext,
  prefetch: RerunPrefetch = EMPTY_PREFETCH
): Promise<MemberOutcome> {
  if (isClaimTemplate(ctx.template)) {
    return sendClaimToMember(member, ctx)
  }
  if (!ctx.campaign.couponConfig) {
    return sendMarketingOnlyToMember(member, ctx)
  }
  return sendEagerToMember(member, ctx, prefetch.existingCoupons.get(member.id))
}

async function sendMarketingOnlyToMember(
  member: Member,
  ctx: SendContext
): Promise<MemberOutcome> {
  const couponDescription = buildCouponDescription(member, ctx, '')
  const result = await sendCampaignBody(member, ctx, '', couponDescription)
  throwIfNotOk(result, 'campaign')
  return recordSent(member, ctx)
}

async function sendClaimToMember(
  member: Member,
  ctx: SendContext
): Promise<MemberOutcome> {
  const result = await sendClaimBody(member, ctx)
  throwIfNotOk(result, 'claim')
  return recordSent(member, ctx)
}

async function sendEagerToMember(
  member: Member,
  ctx: SendContext,
  existing: Coupon | undefined
): Promise<MemberOutcome> {
  // A redeemed / expired / inactive coupon means the member already got
  // (and used up) this campaign — never re-blast a dead code.
  if (existing && !isCouponRedeemable(existing)) {
    console.warn('[Campaign] member already holds a non-redeemable coupon — skipping', {
      campaignId: ctx.campaign.id,
      memberId: member.id,
      couponStatus: existing.status,
    })
    return 'skipped_already_sent'
  }
  const code = existing?.code ?? generateCouponCode()
  const couponDescription = buildCouponDescription(member, ctx, code)
  const result = await sendCampaignBody(member, ctx, code, couponDescription)
  throwIfNotOk(result, 'campaign')
  if (!existing && !(await mintEagerCoupon(member, ctx, code, couponDescription))) {
    return 'sent'
  }
  await sendCouponQr(member, ctx, code)
  return recordSent(member, ctx, code)
}

/**
 * R6: shared success tail for all three modes — count the send and emit the
 * campaign event. `couponCode` is included in `dataJson` only when given
 * (eager mode); claim and marketing-only never pass one.
 */
async function recordSent(
  member: Member,
  ctx: SendContext,
  couponCode?: string
): Promise<MemberOutcome> {
  await incrementCampaignSent(ctx.campaign.id, ctx.campaign.isChargeable)
  await emitEvent({
    restaurantId: ctx.campaign.restaurantId,
    memberId: member.id,
    type: 'campaign',
    dataJson: couponCode
      ? { campaignId: ctx.campaign.id, couponCode }
      : { campaignId: ctx.campaign.id },
  })
  return 'sent'
}

// Re-runs now reuse the existing coupon up front (prefetch), so a 23505 here
// is a genuine race: another writer minted for this (campaign, member) while
// the body was in flight — and that body carries a different code. Tolerate
// it and skip the rest so the member is neither tallied `failed` nor
// double-counted. Returns false when the coupon existed.
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
