import type { Campaign } from '@/domain/entities/campaign'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import {
  isClaimTemplate,
  templateExpectsCouponCode,
} from '@/domain/services/campaign-mode'

export class CampaignCouponConfigMissingError extends Error {
  constructor(templateName: string) {
    super(
      `WhatsApp template ${templateName} expects a coupon code ({{code}} ` +
        'body variable or a dynamic URL button) but this campaign has no ' +
        'coupon configured — add a discount to the campaign or pick a ' +
        'template without a coupon code. This is an OhMyClient pre-send ' +
        'check; Meta was not contacted.'
    )
    this.name = 'CampaignCouponConfigMissingError'
  }
}

export function enforceCouponParams(
  campaign: Campaign,
  template: WhatsAppTemplate | null
): void {
  if (campaign.couponConfig !== null) return
  if (!template) return
  if (isClaimTemplate(template)) return
  if (!templateExpectsCouponCode(template)) return
  throw new CampaignCouponConfigMissingError(template.name)
}
