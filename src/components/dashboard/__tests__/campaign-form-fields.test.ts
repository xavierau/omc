import { describe, it, expect } from 'vitest'
import {
  buildCampaignRequestBody,
  initialCampaignForm,
  CAMPAIGN_TEMPLATE_PLACEHOLDERS,
  validateCampaignForm,
  couponFormMode,
  type CampaignFormState,
} from '@/components/dashboard/campaign-form-fields'
import type { WhatsAppTemplate, TemplateComponent } from '@/domain/entities/whatsapp-template'

function waTemplate(components: TemplateComponent[]): WhatsAppTemplate {
  return {
    id: 'wa-1',
    restaurantId: 'r-1',
    metaTemplateId: 'meta-1',
    name: 'promo_claim',
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

const bodyOnlyTemplate = waTemplate([{ type: 'BODY', text: 'Hi {{name}}' }])
const claimTemplate = waTemplate([
  { type: 'BODY', text: 'Tap to claim your gift' },
  { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Claim' }] },
])

function inlineForm(overrides: Partial<CampaignFormState> = {}): CampaignFormState {
  return {
    ...initialCampaignForm,
    name: 'December Win-back',
    messageType: 'inline',
    templateEn: 'Hi {{contactName}}, use {{couponCode}}',
    templateZhHk: '您好 {{contactName}}，請使用 {{couponCode}}',
    ...overrides,
  }
}

describe('campaign-form-fields', () => {
  describe('initialCampaignForm', () => {
    it('starts with empty bilingual templates', () => {
      expect(initialCampaignForm.templateEn).toBe('')
      expect(initialCampaignForm.templateZhHk).toBe('')
    })

    it('does NOT expose a legacy template field', () => {
      expect(initialCampaignForm).not.toHaveProperty('template')
    })
  })

  describe('CAMPAIGN_TEMPLATE_PLACEHOLDERS', () => {
    it('includes the full union of supported tokens', () => {
      expect(CAMPAIGN_TEMPLATE_PLACEHOLDERS).toEqual(
        expect.arrayContaining([
          '{{contactName}}',
          '{{couponCode}}',
          '{{greeting}}',
          '{{points}}',
        ])
      )
    })
  })

  describe('buildCampaignRequestBody', () => {
    it('emits templateEn and templateZhHk for inline campaigns', () => {
      const body = buildCampaignRequestBody(inlineForm())
      expect(body.templateEn).toBe('Hi {{contactName}}, use {{couponCode}}')
      expect(body.templateZhHk).toBe('您好 {{contactName}}，請使用 {{couponCode}}')
    })

    it('never emits the legacy template field', () => {
      const body = buildCampaignRequestBody(inlineForm())
      expect(body).not.toHaveProperty('template')
    })

    it('emits empty strings for both templates when messageType is wa_template', () => {
      const body = buildCampaignRequestBody(
        inlineForm({ messageType: 'wa_template', whatsappTemplateId: 'wa-1' })
      )
      expect(body.templateEn).toBe('')
      expect(body.templateZhHk).toBe('')
      expect(body.whatsappTemplateId).toBe('wa-1')
    })

    it('maps discount values into couponConfig', () => {
      const body = buildCampaignRequestBody(
        inlineForm({ discountType: 'percentage', discountValue: '20', expiresInDays: '14' })
      )
      expect(body.couponConfig).toEqual({
        discountType: 'percentage',
        discountValue: 20,
        expiresInDays: 14,
      })
    })

    it('passes through the welcome campaign type', () => {
      const body = buildCampaignRequestBody(inlineForm({ type: 'welcome' }))
      expect(body.type).toBe('welcome')
    })

    it('emits null couponConfig when discountValue is empty', () => {
      const body = buildCampaignRequestBody(inlineForm({ discountValue: '' }))
      expect(body.couponConfig).toBeNull()
    })

    it('keeps couponConfig null for blank discount even when expiry is set (marketing-only, #134)', () => {
      const body = buildCampaignRequestBody(inlineForm({ discountValue: '', expiresInDays: '60' }))
      expect(body.couponConfig).toBeNull()
    })

    it('saves expiresInDays 60 when discount is 10 and expiry is 60', () => {
      const body = buildCampaignRequestBody(inlineForm({ discountValue: '10', expiresInDays: '60' }))
      expect(body.couponConfig?.expiresInDays).toBe(60)
    })
  })

  describe('couponFormMode (CAMP-EXPIRY-001 R2: adapter over couponRequirement)', () => {
    const waForm = (discountValue: string) =>
      inlineForm({ messageType: 'wa_template', whatsappTemplateId: 'wa-1', discountValue })
    const plainInline = (discountValue: string) =>
      inlineForm({ templateEn: 'Hi {{contactName}}', templateZhHk: '您好 {{contactName}}', discountValue })

    it('plain inline + blank discount → marketing_only', () => {
      expect(couponFormMode(plainInline(''), null)).toEqual({ mode: 'marketing_only', discount: null })
    })

    it('inline copy with {{couponCode}} + blank discount → blocked (Send would be refused)', () => {
      expect(couponFormMode(inlineForm({ discountValue: '' }), null)).toEqual({ mode: 'blocked', discount: null })
    })

    it('inline only reads the inline texts, never a passed template', () => {
      expect(couponFormMode(plainInline(''), claimTemplate).mode).toBe('marketing_only')
    })

    it('wa_template ignores leftover inline texts', () => {
      // inlineForm's default copy contains {{couponCode}}; a BODY-only template still decides.
      expect(couponFormMode(waForm(''), bodyOnlyTemplate).mode).toBe('marketing_only')
    })

    it('wa_template with a QUICK_REPLY claim button + blank discount → blocked', () => {
      expect(couponFormMode(waForm(''), claimTemplate)).toEqual({ mode: 'blocked', discount: null })
    })

    it('wa_template whose template object is not resolved (loading, failed, not in the list) → unknown', () => {
      expect(couponFormMode(waForm(''), null)).toEqual({ mode: 'unknown', discount: null })
    })

    it.each([
      ['inline with {{couponCode}}', inlineForm({ discountValue: '10' }), null],
      ['wa_template non-claim', waForm('10'), bodyOnlyTemplate],
      ['wa_template claim', waForm('10'), claimTemplate],
      ['wa_template unresolved', waForm('10'), null],
    ] as const)('%s + "10" → discount 10', (_label, form, template) => {
      expect(couponFormMode(form, template)).toEqual({ mode: 'discount', discount: 10 })
    })

    it.each(['0', '-5', 'abc'])('treats discountValue %j as no discount', (discountValue) => {
      expect(couponFormMode(plainInline(discountValue), null)).toEqual({
        mode: 'marketing_only',
        discount: null,
      })
    })
  })

  describe('validateCampaignForm', () => {
    it('returns null when inline form has at least one translation', () => {
      expect(
        validateCampaignForm(inlineForm({ templateEn: 'hello', templateZhHk: '' }))
      ).toBeNull()
    })

    it('requires at least one of EN or zh-HK when inline', () => {
      expect(
        validateCampaignForm(inlineForm({ templateEn: '', templateZhHk: '' }))
      ).toBe('templateAtLeastOneRequired')
    })

    it('treats whitespace-only templates as empty', () => {
      expect(
        validateCampaignForm(inlineForm({ templateEn: '  ', templateZhHk: '\t' }))
      ).toBe('templateAtLeastOneRequired')
    })

    it('requires name when missing', () => {
      expect(validateCampaignForm(inlineForm({ name: '' }))).toBe('nameRequired')
    })

    it('requires whatsappTemplateId when messageType is wa_template', () => {
      expect(
        validateCampaignForm(
          inlineForm({ messageType: 'wa_template', whatsappTemplateId: '' })
        )
      ).toBe('templateRequired')
    })

    it('accepts wa_template when whatsappTemplateId is present (ignores bilingual fields)', () => {
      expect(
        validateCampaignForm(
          inlineForm({
            messageType: 'wa_template',
            whatsappTemplateId: 'wa-1',
            templateEn: '',
            templateZhHk: '',
          })
        )
      ).toBeNull()
    })
  })

  describe('image attachments (ONBOARD-010)', () => {
    it('initialCampaignForm starts with empty image URLs', () => {
      expect(initialCampaignForm.imageUrlEn).toBe('')
      expect(initialCampaignForm.imageUrlZhHk).toBe('')
    })

    it('buildCampaignRequestBody emits null image URLs when empty', () => {
      const body = buildCampaignRequestBody(
        inlineForm({ type: 'welcome', imageUrlEn: '', imageUrlZhHk: '' })
      )
      expect(body.imageUrlEn).toBeNull()
      expect(body.imageUrlZhHk).toBeNull()
    })

    it('buildCampaignRequestBody emits populated image URLs verbatim', () => {
      const body = buildCampaignRequestBody(
        inlineForm({
          type: 'welcome',
          imageUrlEn: 'https://cdn.test/en.jpg',
          imageUrlZhHk: 'https://cdn.test/zh.jpg',
        })
      )
      expect(body.imageUrlEn).toBe('https://cdn.test/en.jpg')
      expect(body.imageUrlZhHk).toBe('https://cdn.test/zh.jpg')
    })

    it('buildCampaignRequestBody drops image URLs for non-welcome types (scope-locked)', () => {
      const body = buildCampaignRequestBody(
        inlineForm({
          type: 'winback',
          imageUrlEn: 'https://cdn.test/en.jpg',
          imageUrlZhHk: 'https://cdn.test/zh.jpg',
        })
      )
      expect(body.imageUrlEn).toBeNull()
      expect(body.imageUrlZhHk).toBeNull()
    })
  })

  describe('tag targeting (TAG-001)', () => {
    it('initialCampaignForm starts with an empty tagIds array', () => {
      expect(initialCampaignForm.tagIds).toEqual([])
    })

    it('emits targetAudience "tag" and tagIds when audience is tag', () => {
      const body = buildCampaignRequestBody(
        inlineForm({ targetAudience: 'tag', tagIds: ['tag-1'] })
      )
      expect(body.targetAudience).toBe('tag')
      expect(body.tagIds).toEqual(['tag-1'])
    })

    it('omits tagIds when audience is all (default)', () => {
      const body = buildCampaignRequestBody(inlineForm({ tagIds: ['tag-1'] }))
      expect(body.targetAudience).toBe('all')
      expect(body).not.toHaveProperty('tagIds')
    })

    it('omits tagIds when audience is selected', () => {
      const body = buildCampaignRequestBody(
        inlineForm({ targetAudience: 'selected', memberIds: ['m-1'], tagIds: ['tag-1'] })
      )
      expect(body).not.toHaveProperty('tagIds')
      expect(body.memberIds).toEqual(['m-1'])
    })

    it('requires a tag when targetAudience is tag and none selected', () => {
      expect(
        validateCampaignForm(inlineForm({ targetAudience: 'tag', tagIds: [] }))
      ).toBe('selectTag')
    })

    it('accepts tag targeting when at least one tag is selected', () => {
      expect(
        validateCampaignForm(inlineForm({ targetAudience: 'tag', tagIds: ['tag-1'] }))
      ).toBeNull()
    })
  })
})
