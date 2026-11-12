import type { WhatsAppTemplate } from '../entities/whatsapp-template'
import { isClaimTemplate, templateExpectsCouponCode } from './campaign-mode'

/**
 * CAMP-EXPIRY-001 R2: the one rule for "does this campaign need a coupon
 * config, and can it be sent without one?". The pre-send guard
 * (enforceCouponParams) throws on 'blocked'; the campaign form shows the
 * matching notice. Keeping both on this function means they cannot drift.
 */
export type CouponRequirementReason = 'claim' | 'template' | 'inline'

export type CouponRequirement =
  | { kind: 'satisfied' }
  | { kind: 'marketing_only' }
  | { kind: 'blocked'; reason: CouponRequirementReason; subject: string }

export interface CouponRequirementInput {
  hasCouponConfig: boolean
  /** The campaign's WhatsApp template; null = an inline text campaign. */
  template: WhatsAppTemplate | null
  /** Inline copy fields; only read when template is null. */
  inlineTexts: ReadonlyArray<string | null | undefined>
  /** NEXT_PUBLIC_APP_URL, so a Book now button is not read as a coupon button (BOOK-001). */
  appUrl?: string
}

// #134 / I-1 round 2: an inline campaign renders its copy through the same
// {{code}}/{{discount}} substitution as a real template's body — a null
// couponConfig blanks the placeholder, so the copy would ship "use code  for  off".
export const INLINE_COUPON_PLACEHOLDERS = ['{{code}}', '{{couponCode}}', '{{discount}}'] as const

const SATISFIED: CouponRequirement = { kind: 'satisfied' }
const MARKETING_ONLY: CouponRequirement = { kind: 'marketing_only' }

export function couponRequirement(input: CouponRequirementInput): CouponRequirement {
  if (input.hasCouponConfig) return SATISFIED
  const { template } = input
  if (!template) return inlineRequirement(input.inlineTexts)
  // Claim mode mints the coupon lazily at tap time, so a claim template with no
  // coupon config would hand out discount-less coupons (#134).
  if (isClaimTemplate(template)) return blocked('claim', template.name)
  if (templateExpectsCouponCode(template, input.appUrl)) return blocked('template', template.name)
  return MARKETING_ONLY
}

function inlineRequirement(texts: CouponRequirementInput['inlineTexts']): CouponRequirement {
  for (const text of texts) {
    if (!text) continue
    const placeholder = INLINE_COUPON_PLACEHOLDERS.find((p) => text.includes(p))
    if (placeholder) return blocked('inline', placeholder)
  }
  return MARKETING_ONLY
}

function blocked(reason: CouponRequirementReason, subject: string): CouponRequirement {
  return { kind: 'blocked', reason, subject }
}
