import type { Campaign } from '@/domain/entities/campaign'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import {
  couponRequirement,
  type CouponRequirementReason,
} from '@/domain/services/coupon-requirement'
import { appBaseUrl } from '@/infrastructure/config/app-url'

const PRE_SEND_CHECK_SUFFIX =
  'This is an OhMyClient pre-send check; Meta was not contacted.'

export class CampaignCouponConfigMissingError extends Error {
  constructor(subject: string, reason: CouponRequirementReason = 'template') {
    super(buildMessage(subject, reason))
    this.name = 'CampaignCouponConfigMissingError'
  }
}

function buildMessage(subject: string, reason: CouponRequirementReason): string {
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

/**
 * #134 / I-1 round 2: `couponConfig === null` means "plain announcement,
 * nothing coupon-related will ever be supplied or minted". Refuse any
 * campaign with no coupon config whose message would need coupon data —
 * a real template (R1/R3) or inline copy (R4). The rule itself lives in
 * couponRequirement, shared with the campaign form (CAMP-EXPIRY-001 R2).
 */
export function enforceCouponParams(
  campaign: Campaign,
  template: WhatsAppTemplate | null
): void {
  const requirement = couponRequirement({
    hasCouponConfig: Boolean(campaign.couponConfig),
    template,
    inlineTexts: [campaign.templateEn, campaign.templateZhHk, campaign.template],
    appUrl: appBaseUrl(),
  })
  if (requirement.kind !== 'blocked') return
  throw new CampaignCouponConfigMissingError(requirement.subject, requirement.reason)
}
