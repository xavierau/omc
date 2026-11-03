import { describe, it, expect } from 'vitest'
import { couponRequirement } from '../coupon-requirement'
import type { TemplateComponent, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

function template(name: string, components: TemplateComponent[]): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'r-1',
    metaTemplateId: null,
    name,
    language: 'zh_HK',
    category: 'MARKETING',
    status: 'approved',
    components,
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  }
}

const claimTemplate = template('claim_promo', [
  { type: 'BODY', text: 'Tap to claim your gift' },
  { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Claim' }] },
])
// Shape of prod nov_promo_2026: IMAGE header + plain BODY, no buttons.
const novPromoShape = template('nov_promo_2026', [
  { type: 'HEADER', format: 'IMAGE' },
  { type: 'BODY', text: 'Hi {{customer_name}}, our November menu is here!' },
])

const noConfig = { hasCouponConfig: false, inlineTexts: [] as string[] }

describe('couponRequirement (CAMP-EXPIRY-001 R2)', () => {
  it('is satisfied whenever a coupon config is set, even for a claim template or {{code}} copy', () => {
    expect(couponRequirement({ hasCouponConfig: true, template: claimTemplate, inlineTexts: [] }))
      .toEqual({ kind: 'satisfied' })
    expect(couponRequirement({ hasCouponConfig: true, template: null, inlineTexts: ['Use {{code}}'] }))
      .toEqual({ kind: 'satisfied' })
  })

  it('blocks a claim (QUICK_REPLY) template with no coupon config, reason claim', () => {
    expect(couponRequirement({ ...noConfig, template: claimTemplate }))
      .toEqual({ kind: 'blocked', reason: 'claim', subject: 'claim_promo' })
  })

  it.each([
    ['a {{code}} body', [{ type: 'BODY', text: 'Your code {{code}}' }]],
    ['a {{discount}} body', [{ type: 'BODY', text: '{{discount}} off today' }]],
    ['a dynamic URL button', [
      { type: 'BODY', text: 'Hi' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Redeem', url: 'https://x.example/{{1}}' }] },
    ]],
    ['a COPY_CODE button', [
      { type: 'BODY', text: 'Hi' },
      { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', text: 'Copy code' }] },
    ]],
  ] as Array<[string, TemplateComponent[]]>)('blocks a template with %s, reason template', (_label, components) => {
    expect(couponRequirement({ ...noConfig, template: template('coupon_tpl', components) }))
      .toEqual({ kind: 'blocked', reason: 'template', subject: 'coupon_tpl' })
  })

  it('is marketing_only for a body-only template like prod nov_promo_2026 (IMAGE header + plain BODY)', () => {
    expect(couponRequirement({ ...noConfig, template: novPromoShape })).toEqual({ kind: 'marketing_only' })
  })

  it('is marketing_only for a template with only a static URL button', () => {
    const staticUrl = template('menu', [
      { type: 'BODY', text: 'Hi' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Menu', url: 'https://x.example/menu' }] },
    ])
    expect(couponRequirement({ ...noConfig, template: staticUrl })).toEqual({ kind: 'marketing_only' })
  })

  it.each(['{{couponCode}}', '{{code}}', '{{discount}}'])(
    'blocks inline copy containing %s, reason inline, subject = the placeholder',
    (placeholder) => {
      expect(couponRequirement({ ...noConfig, template: null, inlineTexts: ['', `Use ${placeholder} now`] }))
        .toEqual({ kind: 'blocked', reason: 'inline', subject: placeholder })
    }
  )

  it('is marketing_only for plain inline copy (null/empty texts skipped)', () => {
    expect(couponRequirement({ ...noConfig, template: null, inlineTexts: [null, '', 'Hi {{contactName}}!'] }))
      .toEqual({ kind: 'marketing_only' })
  })

  it('ignores inline copy when a template is given (the template decides)', () => {
    expect(couponRequirement({ ...noConfig, template: novPromoShape, inlineTexts: ['Use {{couponCode}}'] }))
      .toEqual({ kind: 'marketing_only' })
  })
})
