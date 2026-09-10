import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { sendWhatsAppTemplateMessage } from './send-template-message'
import { recordOutboundSend } from './record-outbound-send'
import { formatDiscount } from './execute-campaign-coupon'
import type { SendContext } from './execute-campaign-batch'
import { Campaign } from '@/domain/entities/campaign'
import { Member } from '@/domain/entities/member'
import { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type {
  MessageCategory,
  MessageContentType,
} from '@/domain/entities/whatsapp-message'
import type { SendResult } from '@/domain/value-objects/send-result'

export function sendCampaignBody(
  member: Member,
  ctx: SendContext,
  code: string,
  couponDescription: string
): Promise<SendResult> {
  const messageType: MessageContentType = ctx.template ? 'template' : 'text'
  return recordOutboundSend({
    restaurantId: ctx.campaign.restaurantId,
    memberId: member.id,
    campaignId: ctx.campaign.id,
    phoneE164: member.phone,
    category: resolveCategory(ctx.template),
    messageType,
    contentPreview: couponDescription.slice(0, 120),
    template: ctx.template
      ? { id: ctx.template.id, name: ctx.template.name }
      : undefined,
    trackingEnabled: ctx.trackingEnabled,
    send: () => sendBody(member, ctx, code, couponDescription),
  })
}

// CAMP-001 claim mode: send ONLY the claim-button template with the
// `CLAIM_<campaignId>` quick-reply payload. No coupon is minted and no code is
// rendered into the body — the coupon/QR are produced lazily when the customer
// taps claim (Stream B). Returns the SendResult so the broadcaster can throw
// on failure (no chargeable increment / event on a failed send).
export function sendClaimBody(
  member: Member,
  ctx: SendContext
): Promise<SendResult> {
  return recordOutboundSend({
    restaurantId: ctx.campaign.restaurantId,
    memberId: member.id,
    campaignId: ctx.campaign.id,
    phoneE164: member.phone,
    category: resolveCategory(ctx.template),
    messageType: 'template',
    contentPreview: (ctx.campaign.name ?? '').slice(0, 120),
    template: ctx.template
      ? { id: ctx.template.id, name: ctx.template.name }
      : undefined,
    trackingEnabled: ctx.trackingEnabled,
    send: () => sendClaimTemplate(member, ctx),
  })
}

export async function sendCouponQr(
  member: Member,
  ctx: SendContext,
  code: string
): Promise<void> {
  try {
    const qrUrl = await uploadCouponQr(code)
    await recordOutboundSend({
      restaurantId: ctx.campaign.restaurantId,
      memberId: member.id,
      campaignId: ctx.campaign.id,
      phoneE164: member.phone,
      category: 'service',
      messageType: 'image',
      contentPreview: `Your code: ${code}`,
      trackingEnabled: ctx.trackingEnabled,
      send: () =>
        sendImageMessage(ctx.phoneNumberId, member.phone, qrUrl, `Your code: ${code}`),
    })
  } catch (err) {
    console.warn('[Campaign] QR send failed:', (err as Error).message)
  }
}

function sendBody(
  member: Member,
  ctx: SendContext,
  code: string,
  couponDescription: string
): Promise<SendResult> {
  if (ctx.template) {
    return sendViaTemplate(ctx.phoneNumberId, member, ctx.campaign, ctx.template, code)
  }
  return sendTextMessage(ctx.phoneNumberId, member.phone, couponDescription)
}

function resolveCategory(template: WhatsAppTemplate | null): MessageCategory {
  if (!template) return 'service'
  return template.category === 'MARKETING' ? 'marketing' : 'utility'
}

function sendViaTemplate(
  phoneNumberId: string,
  member: Member,
  campaign: Campaign,
  template: WhatsAppTemplate,
  code: string
): Promise<SendResult> {
  const discount = formatDiscount(campaign.couponConfig)
  return sendWhatsAppTemplateMessage({
    phoneNumberId,
    to: member.phone,
    template,
    paramValues: {
      customer_name: member.name ?? 'there',
      code,
      discount,
    },
    couponCode: code,
  })
}

// Defensive: claim mode is only entered with a resolved template; a typed
// failure keeps a null template a failed send (→ throw upstream), not a crash.
const CLAIM_NO_TEMPLATE: SendResult = {
  ok: false,
  kapsoMessageId: null,
  raw: null,
  error: { title: 'claim_no_template' },
}

function sendClaimTemplate(
  member: Member,
  ctx: SendContext
): Promise<SendResult> {
  if (!ctx.template) return Promise.resolve(CLAIM_NO_TEMPLATE)
  return sendWhatsAppTemplateMessage({
    phoneNumberId: ctx.phoneNumberId,
    to: member.phone,
    template: ctx.template,
    paramValues: {
      customer_name: member.name ?? 'there',
      discount: formatDiscount(ctx.campaign.couponConfig),
    },
    claimPayload: `CLAIM_${ctx.campaign.id}`,
  })
}
