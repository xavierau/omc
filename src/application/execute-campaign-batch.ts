import { incrementCampaignSent } from '@/infrastructure/supabase/repositories/campaign-repository'
import { emitEvent } from '@/application/emit-event'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/services/template-renderer'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { resolveCampaignTemplate } from './resolve-campaign-template'
import { createCampaignBroadcastCoupon, formatDiscount } from './execute-campaign-coupon'
import { sendCampaignBody, sendCouponQr } from './execute-campaign-send'
import { checkMarketingConsent } from './check-marketing-consent'
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
}

export async function sendInBatches(
  members: Member[],
  ctx: SendContext
): Promise<void> {
  let failedCount = 0
  let skippedNoConsent = 0
  const isMarketing = isMarketingRun(ctx)
  for (let i = 0; i < members.length; i += BATCH_SIZE) {
    const batch = members.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((m) => attemptMember(m, ctx, isMarketing))
    )
    for (const r of results) {
      if (r.status === 'rejected') {
        failedCount++
        console.error('[Campaign] Member send failed:', r.reason)
      } else if (r.value === 'skipped_no_consent') {
        skippedNoConsent++
      }
    }
    if (i + BATCH_SIZE < members.length) await delay(BATCH_DELAY_MS)
  }
  if (failedCount > 0) {
    console.warn(`[Campaign] ${failedCount}/${members.length} sends failed`)
  }
  if (skippedNoConsent > 0) {
    console.warn(
      `[Campaign] ${skippedNoConsent}/${members.length} skipped (marketing consent gate)`
    )
  }
}

type MemberOutcome = 'sent' | 'skipped_no_consent'

async function attemptMember(
  member: Member,
  ctx: SendContext,
  isMarketing: boolean
): Promise<MemberOutcome> {
  if (isMarketing && !(await hasMarketingConsent(ctx, member))) {
    return 'skipped_no_consent'
  }
  await sendToMember(member, ctx)
  return 'sent'
}

async function hasMarketingConsent(
  ctx: SendContext,
  member: Member
): Promise<boolean> {
  const result = await checkMarketingConsent({
    restaurantId: ctx.campaign.restaurantId,
    phoneE164: member.phone,
  })
  return result.allowed
}

function isMarketingRun(ctx: SendContext): boolean {
  // Only WhatsApp template sends carry a Meta-classified category. Inline
  // text/QR campaigns go out as 'service' and are not gated by marketing
  // consent (they are receipt-tied or operational).
  return ctx.template?.category === 'MARKETING'
}

async function sendToMember(member: Member, ctx: SendContext): Promise<void> {
  const code = generateCouponCode()
  const language = resolvePreferredLanguage(member, {
    defaultLanguage: ctx.restaurantDefaultLanguage,
  })
  const resolvedTemplate = resolveCampaignTemplate(ctx.campaign, language)
  const rendered = renderInline(resolvedTemplate ?? '', ctx.campaign, member, code)
  // Coupon description is what admin dashboards show; avoid empty labels by
  // falling back to the campaign name when the rendered template is blank.
  const couponDescription =
    rendered.trim().length > 0 ? rendered : ctx.campaign.name ?? ''
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
