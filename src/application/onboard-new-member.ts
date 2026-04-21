import {
  createWelcomeCoupon,
  createCampaignCoupon,
} from '@/infrastructure/supabase/repositories/coupon-factory'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import type { OnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  getCampaignById,
  incrementCampaignSent,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { Language } from '@/domain/value-objects/language'
import { renderTemplate } from '@/domain/services/template-renderer'
import { emitEvent } from '@/application/emit-event'
import type { Campaign } from '@/domain/entities/campaign'
import { resolveCampaignTemplate } from './resolve-campaign-template'
import {
  defaultWelcomeText,
  defaultCouponCaptionSuffix,
  minimalWelcomeText,
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
 * Run the post-insert welcome flow for a just-created member. Chooses a
 * language from the restaurant's `default_language`, picks a bilingual
 * welcome campaign template (with legacy fallback), mints the coupon,
 * increments counters, emits the join event, and sends the welcome + QR.
 */
export async function onboardNewMember(ctx: OnboardContext): Promise<string> {
  const settings = await loadSettings(ctx.restaurantId)
  const language = Language.fromCodeOrDefault(
    settings?.defaultLanguage ?? null,
    Language.default()
  )
  const campaign = await loadWelcomeCampaign(settings)
  const output = campaign
    ? await onboardViaCampaign(ctx, campaign, language)
    : await onboardViaFallback(ctx, language)

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

async function loadSettings(
  restaurantId: string
): Promise<OnboardingSettings | null> {
  return getOnboardingSettings(restaurantId).catch((err) => {
    console.warn('[onboarding] welcome settings load failed:', err)
    return null
  })
}

async function loadWelcomeCampaign(
  settings: OnboardingSettings | null
): Promise<Campaign | null> {
  if (!settings?.welcomeCampaignId) return null
  return getCampaignById(settings.welcomeCampaignId).catch((err) => {
    console.warn('[onboarding] welcome campaign lookup failed:', err)
    return null
  })
}

async function onboardViaCampaign(
  ctx: OnboardContext,
  campaign: Campaign,
  language: Language
): Promise<OnboardOutput> {
  const coupon = await createCampaignCoupon(
    ctx.restaurantId,
    ctx.memberId,
    campaign,
    ctx.contactName ?? ''
  )
  await incrementCampaignSent(campaign.id, campaign.isChargeable).catch((err) => {
    console.warn('[onboarding] welcome campaign counter increment failed:', err)
  })
  const vars = {
    contactName: ctx.contactName ?? '',
    couponCode: coupon.code,
    name: ctx.contactName ?? '',
    code: coupon.code,
  }
  const resolved = resolveCampaignTemplate(campaign, language)
  const welcomeText =
    resolved !== null
      ? renderTemplate(resolved, vars)
      : minimalWelcomeText(language, coupon.code)
  const suffix = defaultCouponCaptionSuffix(language, coupon.code)
  return { code: coupon.code, welcomeText, caption: `${welcomeText}\n\n${suffix}` }
}

async function onboardViaFallback(
  ctx: OnboardContext,
  language: Language
): Promise<OnboardOutput> {
  const coupon = await createWelcomeCoupon(ctx.restaurantId, ctx.memberId)
  const welcomeText = defaultWelcomeText(language, ctx.contactName, coupon.code)
  const suffix = defaultCouponCaptionSuffix(language, coupon.code)
  return { code: coupon.code, welcomeText, caption: `${welcomeText}\n\n${suffix}` }
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
