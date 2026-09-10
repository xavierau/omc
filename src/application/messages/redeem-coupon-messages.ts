/**
 * Bilingual copy for the `redeemCouponUseCase` outcomes. Pure string builders
 * — no IO. The use case selects the message and the adapter sends it.
 */
import { Language } from '@/domain/value-objects/language'

export function couponNotFoundMessage(language: Language): string {
  return language.equals(Language.EN)
    ? "That code doesn't look right. Please check and try again."
    : '代碼似乎不正確，請檢查後再試。'
}

export function couponInactiveMessage(language: Language): string {
  return language.equals(Language.EN)
    ? 'This coupon is no longer active.'
    : '此優惠券已失效。'
}

export function couponExpiredMessage(language: Language): string {
  return language.equals(Language.EN)
    ? 'This coupon has expired.'
    : '此優惠券已過期。'
}

export function couponMaxUsesMessage(language: Language): string {
  return language.equals(Language.EN)
    ? 'This coupon has reached its maximum uses.'
    : '此優惠券已達使用上限。'
}

export function couponAlreadyUsedMessage(language: Language): string {
  return language.equals(Language.EN)
    ? 'You have already used this coupon.'
    : '您已使用過此優惠券。'
}

interface DiscountShape {
  discountType: string | null
  discountValue: number | null
}

export function couponSuccessMessage(
  language: Language,
  discount: DiscountShape
): string {
  if (discount.discountType === 'percentage' && discount.discountValue) {
    return language.equals(Language.EN)
      ? `Coupon redeemed! You get ${discount.discountValue}% off!`
      : `優惠券已兌換！可享 ${discount.discountValue}% 折扣！`
  }
  if (discount.discountType === 'fixed_amount' && discount.discountValue) {
    return language.equals(Language.EN)
      ? `Coupon redeemed! You get $${discount.discountValue} off!`
      : `優惠券已兌換！可減 $${discount.discountValue}！`
  }
  return language.equals(Language.EN)
    ? 'Coupon redeemed! Enjoy your reward!'
    : '優惠券已兌換！請盡情使用！'
}
