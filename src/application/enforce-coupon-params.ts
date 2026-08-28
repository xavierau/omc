import type { Campaign } from '@/domain/entities/campaign'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import {
  isClaimTemplate,
  templateExpectsCouponCode,
} from '@/domain/services/campaign-mode'

const PRE_SEND_CHECK_SUFFIX =
  'This is an OhMyClient pre-send check; Meta was not contacted.'

type CouponConfigMissingReason = 'template' | 'claim' | 'inline'

export class CampaignCouponConfigMissingError extends Error {
  constructor(subject: string, reason: CouponConfigMissingReason = 'template') {
    super(buildMessage(subject, reason))
    this.name = 'CampaignCouponConfigMissingError'
  }
}

function buildMessage(subject: string, reason: CouponConfigMissingReason): string {
  switch (reason) {
    case 'claim':
      return (
        `WhatsApp template ${subject} mints a coupon when the customer ` +
        'taps Claim, but this campaign has no coupon configured — add a ' +
        `discount to the campaign or pick a different template. ${PRE_SEND_CHECK_SUFFIX}`
      )
    case 'inline':
      return (
        `This campaign's message text references ${subject}, but it has ` +
        'no coupon configured — add a discount to the campaign or remove ' +
        `the placeholder. ${PRE_SEND_CHECK_SUFFIX}`
      )
    case 'template':
      return (
        `WhatsApp template ${subject} expects a coupon code / discount ` +
        '({{code}}, {{discount}}, a dynamic URL button or a COPY_CODE ' +
        'button) but this campaign has no coupon configured — add a ' +
        `discount to the campaign or pick a template without a coupon code. ${PRE_SEND_CHECK_SUFFIX}`
      )
  }
}

// #134 / I-1 round 2: an inline (template === null) campaign renders its
// copy through the same {{code}}/{{discount}} substitution as a real
// template's body — a null couponConfig blanks the placeholder instead of
// throwing, so a coupon-less campaign silently ships "use code  for  off".
const INLINE_COUPON_PLACEHOLDERS = ['{{code}}', '{{couponCode}}', '{{discount}}']

function inlineCopyExpectsCoupon(campaign: Campaign): string | null {
  const texts = [campaign.templateEn, campaign.templateZhHk, campaign.template]
  for (const text of texts) {
    if (!text) continue
    for (const placeholder of INLINE_COUPON_PLACEHOLDERS) {
      if (text.includes(placeholder)) return placeholder
    }
  }
  return null
}

/**
 * #134 / I-1 round 2: `couponConfig === null` means "plain announcement,
 * nothing coupon-related will ever be supplied or minted". Refuse any
 * campaign with no coupon config whose message would need coupon data —
 * a real template (R1/R3) or inline copy (R4).
 */
export function enforceCouponParams(
  campaign: Campaign,
  template: WhatsAppTemplate | null
): void {
  if (campaign.couponConfig) return
  if (!template) {
    const placeholder = inlineCopyExpectsCoupon(campaign)
    if (placeholder) throw new CampaignCouponConfigMissingError(placeholder, 'inline')
    return
  }
  // Claim mode mints the coupon lazily at tap time (claimCampaignCoupon), so
  // a claim template with no coupon config would hand out discount-less
  // coupons — exactly what #134 removed from eager broadcast.
  if (isClaimTemplate(template)) {
    throw new CampaignCouponConfigMissingError(template.name, 'claim')
  }
  if (!templateExpectsCouponCode(template)) return
  throw new CampaignCouponConfigMissingError(template.name, 'template')
}
