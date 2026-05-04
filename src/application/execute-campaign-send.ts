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

export async function sendCampaignBody(
  member: Member,
  ctx: SendContext,
  code: string,
  couponDescription: string
): Promise<void> {
  const category = resolveCategory(ctx.template)
  const messageType: MessageContentType = ctx.template ? 'template' : 'text'
  await recordOutboundSend({
    restaurantId: ctx.campaign.restaurantId,
    memberId: member.id,
    campaignId: ctx.campaign.id,
    phoneE164: member.phone,
    category,
    messageType,
    contentPreview: couponDescription.slice(0, 120),
    template: ctx.template
      ? { id: ctx.template.id, name: ctx.template.name }
      : undefined,
    trackingEnabled: ctx.trackingEnabled,
    send: () => sendBody(member, ctx, code, couponDescription),
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
