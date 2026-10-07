import { describe, it, expect } from 'vitest'
import { buildCampaign, buildWhatsAppTemplate } from '@/test-utils/builders'
import {
  enforceCouponParams,
  CampaignCouponConfigMissingError,
} from '../enforce-coupon-params'

describe('enforceCouponParams', () => {
  it('allows a null template (inline text campaigns) whose copy has no coupon placeholder', () => {
    // buildCampaign()'s default `template` field references {{code}} — override
    // it here so this test isn't accidentally exercising the R4 inline-copy
    // guard (covered separately below).
    const campaign = buildCampaign({ couponConfig: null, template: 'Hi {{name}}, welcome!' })
    expect(() => enforceCouponParams(campaign, null)).not.toThrow()
  })

  it('allows a coupon-configured campaign whose template expects {{code}}', () => {
    const campaign = buildCampaign({
      couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 7 },
    })
    const template = buildWhatsAppTemplate({
      components: [{ type: 'BODY', text: 'Hi {{customer_name}}, code {{code}}' }],
    })
    expect(() => enforceCouponParams(campaign, template)).not.toThrow()
  })

  it('allows a null couponConfig when the template needs neither a body code nor a dynamic URL button', () => {
    const campaign = buildCampaign({ couponConfig: null })
    const template = buildWhatsAppTemplate({
      components: [
        { type: 'BODY', text: 'Hi {{customer_name}}!' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', text: 'Visit', url: 'https://x.example/menu' }],
        },
      ],
    })
    expect(() => enforceCouponParams(campaign, template)).not.toThrow()
  })

  it('throws when couponConfig is null and the body references {{code}}', () => {
    const campaign = buildCampaign({ couponConfig: null })
    const template = buildWhatsAppTemplate({
      name: 'free_drink',
      components: [{ type: 'BODY', text: 'Hi {{customer_name}}, code {{code}}' }],
    })
    expect(() => enforceCouponParams(campaign, template)).toThrow(
      CampaignCouponConfigMissingError
    )
    expect(() => enforceCouponParams(campaign, template)).toThrow('free_drink')
    expect(() => enforceCouponParams(campaign, template)).toThrow('OhMyClient')
  })

  it('throws when couponConfig is null and a URL button is dynamic ({{1}})', () => {
    const campaign = buildCampaign({ couponConfig: null })
    const template = buildWhatsAppTemplate({
      name: 'free_drink',
      components: [
        { type: 'BODY', text: 'Hi {{customer_name}}!' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', text: 'Redeem', url: 'https://x.example/{{1}}' }],
        },
      ],
    })
    expect(() => enforceCouponParams(campaign, template)).toThrow(
      CampaignCouponConfigMissingError
    )
  })

  it('allows a null couponConfig when a URL button is static (no {{1}})', () => {
    const campaign = buildCampaign({ couponConfig: null })
    const template = buildWhatsAppTemplate({
      components: [
        { type: 'BODY', text: 'Hi {{customer_name}}!' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', text: 'Visit', url: 'https://x.example/menu' }],
        },
      ],
    })
    expect(() => enforceCouponParams(campaign, template)).not.toThrow()
  })

  // R3 (round 2 / #134): reverses the pre-round-2 claim exemption. Claim
  // mode mints the coupon lazily at tap time (claimCampaignCoupon), so a
  // claim template with a null couponConfig would still hand out a
  // discount-less coupon — exactly the gap #134 closed for eager broadcast.
  it('throws when couponConfig is null and the template is claim mode (QUICK_REPLY) — claim mints at tap time', () => {
    const campaign = buildCampaign({ couponConfig: null, template: 'Hi {{name}}!' })
    const template = buildWhatsAppTemplate({
      name: 'claim_promo',
      components: [
        { type: 'BODY', text: 'Hi {{customer_name}}' },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Claim' }] },
      ],
    })
    expect(() => enforceCouponParams(campaign, template)).toThrow(
      CampaignCouponConfigMissingError
    )
    expect(() => enforceCouponParams(campaign, template)).toThrow('taps Claim')
  })

  it('allows a claim (QUICK_REPLY) template when couponConfig is set', () => {
    const campaign = buildCampaign({
      couponConfig: { discountType: 'percentage', discountValue: 10, expiresInDays: 7 },
    })
    const template = buildWhatsAppTemplate({
      components: [
        { type: 'BODY', text: 'Hi {{customer_name}}, code {{code}}' },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Claim' }] },
      ],
    })
    expect(() => enforceCouponParams(campaign, template)).not.toThrow()
  })

  // R1 (round 2 / #134): {{discount}} is filled from
  // formatDiscount(couponConfig), which is '' when couponConfig is null.
  it('throws when couponConfig is null and the body references {{discount}}', () => {
    const campaign = buildCampaign({ couponConfig: null })
    const template = buildWhatsAppTemplate({
      name: 'percent_off',
      components: [{ type: 'BODY', text: 'Hi {{customer_name}}, {{discount}} off today' }],
    })
    expect(() => enforceCouponParams(campaign, template)).toThrow(
      CampaignCouponConfigMissingError
    )
  })

  // R1 (round 2 / #134): a COPY_CODE button's sole purpose is a coupon code.
  it('throws when couponConfig is null and a button is COPY_CODE', () => {
    const campaign = buildCampaign({ couponConfig: null })
    const template = buildWhatsAppTemplate({
      name: 'copy_code_promo',
      components: [
        { type: 'BODY', text: 'Hi {{customer_name}}!' },
        { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', text: 'Copy code' }] },
      ],
    })
    expect(() => enforceCouponParams(campaign, template)).toThrow(
      CampaignCouponConfigMissingError
    )
  })

  // R3: must use a truthiness check (campaign.couponConfig), not
  // `!== null` — undefined would otherwise slip through as "configured".
  it('throws when couponConfig is undefined (not just null) and the body references {{code}}', () => {
    const campaign = buildCampaign({ couponConfig: undefined })
    const template = buildWhatsAppTemplate({
      name: 'free_drink',
      components: [{ type: 'BODY', text: 'Hi {{customer_name}}, code {{code}}' }],
    })
    expect(() => enforceCouponParams(campaign, template)).toThrow(
      CampaignCouponConfigMissingError
    )
  })

  // R4 (round 2 / #134): the marketing-only branch also covers inline text
  // campaigns (template === null) — a null couponConfig with a coupon
  // placeholder left in the copy renders as an empty string, not a real code.
  it('throws when couponConfig is null and the inline templateEn references {{couponCode}}', () => {
    const campaign = buildCampaign({
      couponConfig: null,
      template: 'legacy copy, no placeholder',
      templateEn: 'Use code {{couponCode}} for a discount!',
    })
    expect(() => enforceCouponParams(campaign, null)).toThrow(
      CampaignCouponConfigMissingError
    )
    expect(() => enforceCouponParams(campaign, null)).toThrow('{{couponCode}}')
  })

  it('allows a null template when no inline copy field references a coupon placeholder', () => {
    const campaign = buildCampaign({
      couponConfig: null,
      template: 'legacy copy, no placeholder',
      templateEn: 'Hi {{name}}, thanks for visiting!',
      templateZhHk: null,
    })
    expect(() => enforceCouponParams(campaign, null)).not.toThrow()
  })
})
