import {
  createWelcomeCoupon,
  createCampaignCoupon,
} from '@/infrastructure/supabase/repositories/coupon-factory'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  getCampaignById,
  incrementCampaignSent,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { renderTemplate } from '@/domain/services/template-renderer'
import { emitEvent } from '@/application/emit-event'
import type { Campaign } from '@/domain/entities/campaign'
import {
  defaultWelcomeText,
  defaultCouponCaption,
} from './onboarding-defaults'

export interface OnboardContext {
  restaurantId: string
  memberId: string
  phoneNumberId: string
  phone: string
  contactName?: string
}

interface OnboardOutput {
  code: string
  welcomeText: string
  caption: string
}

/**
 * Run the post-insert welcome flow for a just-created member: pick the
 * restaurant's welcome campaign (or the hardcoded fallback), mint the
 * coupon, increment the (non-)chargeable counter, emit the join event,
 * and send the welcome text + coupon QR image. Returns the coupon code.
 */
export async function onboardNewMember(ctx: OnboardContext): Promise<string> {
  const campaign = await resolveWelcomeCampaign(ctx.restaurantId)
  const output = campaign
    ? await onboardViaCampaign(ctx, campaign)
    : await onboardViaFallback(ctx)

  await emitEvent({
    restaurantId: ctx.restaurantId,
    memberId: ctx.memberId,
    type: 'join',
    dataJson: { source: 'whatsapp', coupon_code: output.code },
  })

  await sendTextMessage(ctx.phoneNumberId, ctx.phone, output.welcomeText)
  await sendCouponQrImage(ctx.phoneNumberId, ctx.phone, output.code, output.caption)
  return output.code
}

async function resolveWelcomeCampaign(
  restaurantId: string
): Promise<Campaign | null> {
  const settings = await getOnboardingSettings(restaurantId).catch((err) => {
    console.warn('[onboarding] welcome settings load failed:', err)
    return null
  })
  if (!settings?.welcomeCampaignId) return null
  return getCampaignById(settings.welcomeCampaignId).catch((err) => {
    console.warn('[onboarding] welcome campaign lookup failed:', err)
    return null
  })
}

async function onboardViaCampaign(
  ctx: OnboardContext,
  campaign: Campaign
): Promise<OnboardOutput> {
  const coupon = await createCampaignCoupon(
    ctx.restaurantId,
    ctx.memberId,
    campaign,
    ctx.contactName ?? ''
  )
  await incrementCampaignSent(campaign.id, campaign.isChargeable).catch((err) => {
    console.warn('[onboarding] incrementCampaignSent failed (via campaign):', err)
  })
  // {{name}}/{{code}} aliases support existing campaign-builder templates;
  // {{contactName}}/{{couponCode}} are the onboarding-explicit names.
  const vars = {
    contactName: ctx.contactName ?? '',
    couponCode: coupon.code,
    name: ctx.contactName ?? '',
    code: coupon.code,
  }
  const welcomeText = renderTemplate(campaign.template, vars)
  const caption =
    `${welcomeText}\n\nYour code: ${coupon.code}\n` +
    `Show this QR to our staff to redeem.`
  return { code: coupon.code, welcomeText, caption }
}

async function onboardViaFallback(ctx: OnboardContext): Promise<OnboardOutput> {
  const coupon = await createWelcomeCoupon(ctx.restaurantId, ctx.memberId)
  return {
    code: coupon.code,
    welcomeText: defaultWelcomeText(ctx.contactName, coupon.code),
    caption: defaultCouponCaption(coupon.code),
  }
}

async function sendCouponQrImage(
  phoneNumberId: string,
  phone: string,
  couponCode: string,
  caption: string
): Promise<void> {
  try {
    const qrUrl = await uploadCouponQr(couponCode)
    await sendImageMessage(phoneNumberId, phone, qrUrl, caption)
  } catch (err) {
    console.warn('[QR] Failed to send coupon QR:', (err as Error).message)
  }
}
