import { describe, it, expect } from 'vitest'
import { isClaimTemplate, templateExpectsCouponCode } from '../campaign-mode'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

function template(
  buttons?: WhatsAppTemplate['components'][number]['buttons']
): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'r-1',
    metaTemplateId: null,
    name: 'promo',
    language: 'en',
    category: 'MARKETING',
    status: 'approved',
    components: buttons
      ? [{ type: 'BODY', text: 'Hi' }, { type: 'BUTTONS', buttons }]
      : [{ type: 'BODY', text: 'Hi' }],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

describe('isClaimTemplate', () => {
  it('is claim mode when any button is a QUICK_REPLY', () => {
    expect(
      isClaimTemplate(template([{ type: 'URL', text: 'Go', url: 'https://x' }, { type: 'QUICK_REPLY', text: 'Claim' }]))
    ).toBe(true)
  })

  it('is eager mode without a QUICK_REPLY button, without buttons, or without a template', () => {
    expect(isClaimTemplate(template([{ type: 'URL', text: 'Go', url: 'https://x' }]))).toBe(false)
    expect(isClaimTemplate(template())).toBe(false)
    expect(isClaimTemplate(null)).toBe(false)
  })
})

// #134 / I-1: a template that needs a coupon code either interpolates it into
// the body ({{code}}) or into a dynamic URL button ({{1}}). Used by
// enforceCouponParams to catch a coupon-less campaign before it blasts an
// empty body parameter / no button parameter to Meta for every recipient.
describe('templateExpectsCouponCode', () => {
  function templateWithBody(
    text: string,
    buttons?: WhatsAppTemplate['components'][number]['buttons']
  ): WhatsAppTemplate {
    const t = template(buttons)
    return {
      ...t,
      components: buttons
        ? [{ type: 'BODY', text }, { type: 'BUTTONS', buttons }]
        : [{ type: 'BODY', text }],
    }
  }

  it('is true when the body references {{code}}', () => {
    expect(
      templateExpectsCouponCode(templateWithBody('Hi {{customer_name}}, code {{code}}'))
    ).toBe(true)
  })

  it('is true when a URL button is dynamic ({{1}})', () => {
    expect(
      templateExpectsCouponCode(
        templateWithBody('Hi!', [{ type: 'URL', text: 'Redeem', url: 'https://x.example/{{1}}' }])
      )
    ).toBe(true)
  })

  it('is false when neither the body nor any button references a code', () => {
    expect(
      templateExpectsCouponCode(
        templateWithBody('Hi {{customer_name}}!', [
          { type: 'URL', text: 'Visit', url: 'https://x.example/menu' },
        ])
      )
    ).toBe(false)
    expect(templateExpectsCouponCode(templateWithBody('Hi!'))).toBe(false)
  })
})
