import {
  extractParameters,
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
 * #134 / I-1: a template that references {{code}} in its body, or has a URL
 * button whose url is dynamic ({{1}}), expects a coupon code to be supplied.
 * Used by enforceCouponParams to catch a coupon-less campaign that would
 * otherwise blast an empty body parameter / no button parameter to Meta.
 */
export function templateExpectsCouponCode(template: WhatsAppTemplate): boolean {
  if (extractParameters(template).includes('code')) return true
  const buttonsComponent = template.components.find((c) => c.type === 'BUTTONS')
  return Boolean(
    buttonsComponent?.buttons?.some(
      (b) => b.type === 'URL' && b.url?.includes('{{1}}')
    )
  )
}
