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
import { Language } from '@/domain/value-objects/language'
import { renderTemplate } from '@/domain/services/template-renderer'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'
import { resolveLocalizedImageUrl } from '@/domain/services/resolve-localized-image-url'
import { emitEvent } from '@/application/emit-event'
import type { Campaign } from '@/domain/entities/campaign'
import { resolveCampaignTemplate } from './resolve-campaign-template'
import { sendWelcomeBody, sendCouponQrImage } from './onboard-send-helpers'
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
  memberPreferredLanguage: string | null
}

interface OnboardOutput {
  code: string
  welcomeText: string
  caption: string
  welcomeImageUrl: string | null
}

/**
 * Run the post-insert welcome flow for a just-created member. Chooses a
 * language, picks a bilingual welcome campaign template + optional image
 * (strict per-language match), mints the coupon, increments counters,
 * emits the join event, and sends one welcome message (image+caption when
 * an image is attached, else text-only) plus the QR coupon as a second
 * message.
 */
export async function onboardNewMember(ctx: OnboardContext): Promise<string> {
  const settings = await loadSettings(ctx.restaurantId)
  const language = resolvePreferredLanguage(
    { preferredLanguage: ctx.memberPreferredLanguage },
    { defaultLanguage: settings?.defaultLanguage ?? null }
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

  const target = { phoneNumberId: ctx.phoneNumberId, phone: ctx.phone }
  await sendWelcomeBody(target, output.welcomeText, output.welcomeImageUrl)
  await sendCouponQrImage(target, output.code, output.caption)
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
  let coupon: { code: string; id: string }
  try {
    coupon = await createCampaignCoupon(
      ctx.restaurantId,
      ctx.memberId,
      campaign,
      ctx.contactName ?? ''
    )
    await incrementCampaignSent(campaign.id, campaign.isChargeable).catch((err) => {
      console.warn('[onboarding] welcome campaign counter increment failed:', err)
    })
  } catch (err) {
    // Campaign mapping exists but is broken (e.g. missing coupon_config).
    // Mirror register-member-web.ts: keep the campaign's text/image, but
    // mint a hardcoded welcome coupon so onboarding still succeeds.
    console.warn('[onboarding] campaign coupon mint failed, using welcome fallback:', (err as Error).message)
    coupon = await createWelcomeCoupon(ctx.restaurantId, ctx.memberId)
  }
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
  const welcomeImageUrl = resolveLocalizedImageUrl({
    en: campaign.imageUrlEn,
    zhHk: campaign.imageUrlZhHk,
    preferred: language,
  })
  return {
    code: coupon.code,
    welcomeText,
    caption: `${welcomeText}\n\n${suffix}`,
    welcomeImageUrl,
  }
}

async function onboardViaFallback(
  ctx: OnboardContext,
  language: Language
): Promise<OnboardOutput> {
  const coupon = await createWelcomeCoupon(ctx.restaurantId, ctx.memberId)
  const welcomeText = defaultWelcomeText(language, ctx.contactName, coupon.code)
  const suffix = defaultCouponCaptionSuffix(language, coupon.code)
  return {
    code: coupon.code,
    welcomeText,
    caption: `${welcomeText}\n\n${suffix}`,
    welcomeImageUrl: null,
  }
}
