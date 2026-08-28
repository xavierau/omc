import {
  extractParameters,
  isDynamicUrlButton,
  type WhatsAppTemplate,
} from '../entities/whatsapp-template'

/**
 * CAMP-001: broadcast mode is inferred from template shape — a template with
 * a QUICK_REPLY button is a claim-mode template (coupon + QR minted lazily on
 * tap); anything else is eager mode (mint + push the QR up front). CAMP-004
 * tracks replacing this inference with an explicit campaign flag.
 */
export function isClaimTemplate(template: WhatsAppTemplate | null): boolean {
  if (!template) return false
  const buttonsComponent = template.components.find((c) => c.type === 'BUTTONS')
  return Boolean(
    buttonsComponent?.buttons?.some((b) => b.type === 'QUICK_REPLY')
  )
}

/**
 * #134 / I-1 (round 2 / R1): a template expects a coupon to be minted when
 * any of the following hold:
 *  - its body references {{code}}, OR {{discount}} — the sender fills
 *    {{discount}} from formatDiscount(couponConfig), which renders '' when
 *    couponConfig is null, the same empty-parameter problem as {{code}};
 *  - it has a BUTTONS component with a dynamic URL button ({{1}}); or
 *  - it has a COPY_CODE button — its sole purpose is a coupon code (the
 *    sender does not currently build a COPY_CODE parameter at all; that's a
 *    pre-existing gap in send-template-message.ts, not something this
 *    predicate should paper over by staying silent).
 * Used by enforceCouponParams to catch a coupon-less campaign that would
 * otherwise blast an empty/dead parameter to Meta.
 */
export function templateExpectsCouponCode(template: WhatsAppTemplate): boolean {
  const params = extractParameters(template)
  if (params.includes('code') || params.includes('discount')) return true
  const buttonsComponent = template.components.find((c) => c.type === 'BUTTONS')
  return Boolean(
    buttonsComponent?.buttons?.some(
      (b) => isDynamicUrlButton(b) || b.type === 'COPY_CODE'
    )
  )
}
