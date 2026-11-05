import {
  extractParameters,
  isDynamicUrlButton,
  type WhatsAppTemplate,
} from '../entities/whatsapp-template'
import { isClaimTemplate } from './campaign-mode'

export interface QrOnlyCouponInput {
  type: string
  hasCouponConfig: boolean
  template: WhatsAppTemplate | null
}

// A template's code travels in a variable or a button. {{discount}} is not a
// code, which is why templateExpectsCouponCode cannot answer this question.
const CODE_PARAMETERS = ['code', 'couponCode']

/**
 * CAMP-014: true when a coupon code reaches the customer only in the free-form
 * QR image sent after the template. Free-form needs an open 24-hour window, so
 * customers who have not written in get the offer with no usable code. Claim
 * templates send the QR after a tap, which opens the window. Welcome customers
 * have just written in. Inline campaigns (no template) are out of scope.
 */
export function isQrOnlyCouponCampaign(input: QrOnlyCouponInput): boolean {
  const { template } = input
  if (!template || !input.hasCouponConfig) return false
  if (input.type === 'welcome' || isClaimTemplate(template)) return false
  return !templateCarriesCode(template)
}

function templateCarriesCode(template: WhatsAppTemplate): boolean {
  if (extractParameters(template).some((p) => CODE_PARAMETERS.includes(p))) return true
  const buttons = template.components.find((c) => c.type === 'BUTTONS')?.buttons ?? []
  return buttons.some((b) => isDynamicUrlButton(b) || b.type === 'COPY_CODE')
}
