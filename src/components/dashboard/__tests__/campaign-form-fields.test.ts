import { describe, it, expect } from 'vitest'
import {
  buildCampaignRequestBody,
  initialCampaignForm,
  CAMPAIGN_TEMPLATE_PLACEHOLDERS,
  validateCampaignForm,
  type CampaignFormState,
} from '@/components/dashboard/campaign-form-fields'

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
})
