/**
 * Hardcoded fallback copy used when a restaurant has not mapped a welcome
 * campaign or set a custom returning-member template. Bilingual (EN + zh-HK);
 * the caller selects the language from the restaurant's `default_language`.
 * Pure string builders so tests can assert verbatim equality.
 */
import { Language } from '@/domain/value-objects/language'

export function defaultWelcomeText(
  language: Language,
  contactName: string | null | undefined,
  couponCode: string
): string {
  if (language.equals(Language.ZH_HK)) {
    return buildWelcomeZh(contactName, couponCode)
  }
  return buildWelcomeEn(contactName, couponCode)
}

export function defaultReturningText(
  language: Language,
  greeting: string,
  pointsBalance: number
): string {
  if (language.equals(Language.ZH_HK)) {
    return (
      `${greeting} 您已經是會員。` +
      `您目前有 ${pointsBalance} 積分。` +
      `回覆 POINTS 查詢積分餘額，或傳送收據相片賺取更多積分。`
    )
  }
  return (
    `${greeting} You're already a member. ` +
    `Your balance: ${pointsBalance} points. ` +
    `Reply POINTS to check balance or send a receipt photo to earn more.`
  )
}

/**
 * Localized "Welcome back" greeting used as the `{{greeting}}` placeholder in
 * custom returning-member templates. Must be language-matched so zh_hk
 * templates don't leak English literals.
 */
export function buildReturningGreeting(
  language: Language,
  name?: string | null
): string {
  if (language.equals(Language.EN)) {
    return name ? `Welcome back, ${name}!` : 'Welcome back!'
  }
  return name ? `歡迎回來，${name}！` : '歡迎回來！'
}

/** Minimal welcome text used when the welcome flow cannot build a full message. */
export function minimalWelcomeText(
  language: Language,
  couponCode: string
): string {
  if (language.equals(Language.ZH_HK)) {
    return (
      `歡迎加入我們的會員計劃！\n\n` +
      `您的歡迎代碼：${couponCode}\n\n` +
      `回覆 POINTS 查詢積分，或傳送收據相片賺取積分。`
    )
  }
  return (
    `Welcome to our loyalty program!\n\n` +
    `Your welcome code: ${couponCode}\n\n` +
    `Reply POINTS to check balance, or send a receipt photo to earn points.`
  )
}

/**
 * Caption suffix appended to the coupon-QR image, after the localized welcome
 * text. Tells the member what to do with the QR.
 */
export function defaultCouponCaptionSuffix(
  language: Language,
  couponCode: string
): string {
  if (language.equals(Language.ZH_HK)) {
    return `您的代碼：${couponCode}\n向我們的職員出示此 QR Code 以兌換優惠。`
  }
  return (
    `Your code: ${couponCode}\n` +
    `Show this QR code to our staff to redeem.`
  )
}

function buildWelcomeEn(
  contactName: string | null | undefined,
  couponCode: string
): string {
  const nameSuffix = contactName ? `, ${contactName}` : ''
  return (
    `Welcome to our loyalty program${nameSuffix}!\n\n` +
    `You've received a welcome gift!\n` +
    `Use code: ${couponCode}\n\n` +
    `Reply POINTS to check balance, or send a receipt photo to earn points.`
  )
}

function buildWelcomeZh(
  contactName: string | null | undefined,
  couponCode: string
): string {
  const nameSuffix = contactName ? `，${contactName}` : ''
  return (
    `歡迎加入我們的會員計劃${nameSuffix}！\n\n` +
    `您已獲得歡迎禮物！\n` +
    `請使用代碼：${couponCode}\n\n` +
    `回覆 POINTS 查詢積分，或傳送收據相片賺取積分。`
  )
}
