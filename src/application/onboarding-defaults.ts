/**
 * Hardcoded fallback copy used when a restaurant has not mapped a welcome
 * campaign or set a custom returning-member template. Kept as pure string
 * builders so tests can assert verbatim equality.
 */

export function defaultWelcomeText(
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

export function defaultReturningText(
  greeting: string,
  pointsBalance: number
): string {
  return (
    `${greeting} You're already a member. ` +
    `Your balance: ${pointsBalance} points. ` +
    `Reply POINTS to check balance or send a receipt photo to earn more.`
  )
}

/**
 * Fallback used when no welcome campaign is mapped AND coupon QR is sent —
 * matches the pre-ONBOARD-004 caption verbatim.
 */
export function defaultCouponCaption(couponCode: string): string {
  return (
    `Your Welcome Coupon: ${couponCode}\n\n` +
    `Show this QR code to our staff to redeem.`
  )
}

/** Minimal welcome text used when the coupon creation itself fails. */
export function minimalWelcomeText(
  contactName: string | null | undefined
): string {
  const nameSuffix = contactName ? `, ${contactName}` : ''
  return (
    `Welcome to our loyalty program${nameSuffix}!\n\n` +
    `Reply POINTS to check balance, or send a receipt photo to earn points.`
  )
}
