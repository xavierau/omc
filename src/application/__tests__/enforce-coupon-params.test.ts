import { describe, it, expect } from 'vitest'
import { buildCampaign, buildWhatsAppTemplate } from '@/test-utils/builders'
import {
  enforceCouponParams,
  CampaignCouponConfigMissingError,
} from '../enforce-coupon-params'

describe('enforceCouponParams', () => {
  it('allows a null template (inline text campaigns)', () => {
    const campaign = buildCampaign({ couponConfig: null })
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

  it('allows a claim (QUICK_REPLY) template with {{code}} and null couponConfig — claim mode never passes a code', () => {
    const campaign = buildCampaign({ couponConfig: null })
    const template = buildWhatsAppTemplate({
      components: [
        { type: 'BODY', text: 'Hi {{customer_name}}, code {{code}}' },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Claim' }] },
      ],
    })
    expect(() => enforceCouponParams(campaign, template)).not.toThrow()
  })
})
