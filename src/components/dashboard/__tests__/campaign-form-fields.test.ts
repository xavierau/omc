import { describe, it, expect } from 'vitest'
import {
  buildCampaignRequestBody,
  initialCampaignForm,
  CAMPAIGN_TEMPLATE_PLACEHOLDERS,
  validateCampaignForm,
  couponFormMode,
  type CampaignFormState,
} from '@/components/dashboard/campaign-form-fields'
import {
  couponFormQrOnly,
  templateLookup,
  singleTemplateIdToFetch,
  pickerTemplates,
  type TemplateLookup,
  type TemplateListSource,
  type SingleTemplateSource,
} from '@/components/dashboard/campaign-form-types'
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

  describe('couponFormQrOnly (CAMP-014: warn only, on the shared domain rule)', () => {
    const qrOnlyTemplate = waTemplate([{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Show your QR' }])
    const form = (overrides: Partial<CampaignFormState> = {}) =>
      inlineForm({ messageType: 'wa_template', whatsappTemplateId: 'wa-1', discountValue: '10', ...overrides })
    const resolved = (template: WhatsAppTemplate): TemplateLookup => ({ status: 'resolved', template })

    it('warns when the selected template leaves the code only in the QR', () => {
      expect(couponFormQrOnly(form(), resolved(qrOnlyTemplate))).toBe(true)
    })

    it('does not warn for a claim template', () => {
      expect(couponFormQrOnly(form(), resolved(claimTemplate))).toBe(false)
    })

    it('does not warn without a discount: no coupon is issued', () => {
      expect(couponFormQrOnly(form({ discountValue: '' }), resolved(qrOnlyTemplate))).toBe(false)
    })

    it('does not warn for a welcome campaign', () => {
      expect(couponFormQrOnly(form({ type: 'welcome' }), resolved(qrOnlyTemplate))).toBe(false)
    })

    it('does not warn for inline copy, even with a stale resolved lookup', () => {
      expect(couponFormQrOnly(form({ messageType: 'inline' }), resolved(qrOnlyTemplate))).toBe(false)
    })

    it.each(['loading', 'error', 'unselected'] as const)('does not warn while the lookup is %s', (status) => {
      expect(couponFormQrOnly(form(), { status })).toBe(false)
    })

    it('never blocks: validation still passes for a qr-only template', () => {
      expect(validateCampaignForm(form({ name: 'Promo' }))).toBeNull()
    })
  })

  describe('couponFormMode (CAMP-EXPIRY-001 R3: adapter over couponRequirement + welcome rule)', () => {
    const waForm = (discountValue: string) =>
      inlineForm({ messageType: 'wa_template', whatsappTemplateId: 'wa-1', discountValue })
    const plainInline = (discountValue: string) =>
      inlineForm({ templateEn: 'Hi {{contactName}}', templateZhHk: '您好 {{contactName}}', discountValue })
    const resolved = (template: WhatsAppTemplate): TemplateLookup => ({ status: 'resolved', template })
    const unselected: TemplateLookup = { status: 'unselected' }

    it('plain inline + blank discount → marketing_only', () => {
      expect(couponFormMode(plainInline(''), unselected)).toEqual({ mode: 'marketing_only' })
    })

    it('inline copy with {{couponCode}} + blank discount → blocked (Send would be refused)', () => {
      expect(couponFormMode(inlineForm({ discountValue: '' }), unselected)).toEqual({ mode: 'blocked' })
    })

    it('inline only reads the inline texts, never a resolved template', () => {
      expect(couponFormMode(plainInline(''), resolved(claimTemplate)).mode).toBe('marketing_only')
    })

    it('wa_template ignores leftover inline texts', () => {
      // inlineForm's default copy contains {{couponCode}}; a BODY-only template still decides.
      expect(couponFormMode(waForm(''), resolved(bodyOnlyTemplate)).mode).toBe('marketing_only')
    })

    it('wa_template with a QUICK_REPLY claim button + blank discount → blocked', () => {
      expect(couponFormMode(waForm(''), resolved(claimTemplate))).toEqual({ mode: 'blocked' })
    })

    it.each(['loading', 'error', 'unselected'] as const)(
      'wa_template + blank discount while the template lookup is %s → unknown, carrying why',
      (status) => {
        expect(couponFormMode(waForm(''), { status })).toEqual({ mode: 'unknown', pending: status })
      }
    )

    it.each([
      ['inline with {{couponCode}}', inlineForm({ discountValue: '10' }), unselected],
      ['wa_template non-claim', waForm('10'), resolved(bodyOnlyTemplate)],
      ['wa_template claim', waForm('10'), resolved(claimTemplate)],
      ['wa_template still loading', waForm('10'), { status: 'loading' } as TemplateLookup],
    ] as const)('%s + "10" → discount', (_label, form, lookup) => {
      expect(couponFormMode(form, lookup)).toEqual({ mode: 'discount' })
    })

    it.each(['0', '-5', 'abc'])('treats discountValue %j as no discount', (discountValue) => {
      expect(couponFormMode(plainInline(discountValue), unselected)).toEqual({ mode: 'marketing_only' })
    })

    describe('welcome campaigns (the welcome send path always mints a coupon)', () => {
      const welcome = (overrides: Partial<CampaignFormState>) => inlineForm({ type: 'welcome', ...overrides })

      it.each([
        ['plain inline', welcome({ templateEn: 'Hi', templateZhHk: '您好', discountValue: '' }), unselected],
        ['inline with {{couponCode}}', welcome({ discountValue: '' }), unselected],
        ['wa_template claim', welcome({ messageType: 'wa_template', whatsappTemplateId: 'wa-1', discountValue: '' }), resolved(claimTemplate)],
        ['wa_template still loading', welcome({ messageType: 'wa_template', whatsappTemplateId: 'wa-1', discountValue: '' }), { status: 'loading' } as TemplateLookup],
        ['discount "0"', welcome({ discountValue: '0' }), unselected],
      ] as const)('%s + no discount → welcome_requires_discount', (_label, form, lookup) => {
        expect(couponFormMode(form, lookup)).toEqual({ mode: 'welcome_requires_discount' })
      })

      it('welcome + "10" → discount, and the form validates', () => {
        const form = welcome({ discountValue: '10' })
        expect(couponFormMode(form, unselected)).toEqual({ mode: 'discount' })
        expect(validateCampaignForm(form)).toBeNull()
        expect(buildCampaignRequestBody(form).couponConfig?.discountValue).toBe(10)
      })

      it('welcome + blank discount → validateCampaignForm blocks Save with welcomeDiscountRequired', () => {
        expect(validateCampaignForm(welcome({ discountValue: '' }))).toBe('welcomeDiscountRequired')
        expect(validateCampaignForm(welcome({ discountValue: '0' }))).toBe('welcomeDiscountRequired')
      })

      it('non-welcome campaigns may still be saved without a discount (#134 marketing-only)', () => {
        expect(validateCampaignForm(inlineForm({ type: 'promo', discountValue: '' }))).toBeNull()
      })
    })
  })

  describe('templateLookup / singleTemplateIdToFetch (R3-2: resolve beyond the first page)', () => {
    const otherTemplate = { ...bodyOnlyTemplate, id: 'wa-2' }
    const listOf = (templates: WhatsAppTemplate[], over: Partial<TemplateListSource> = {}): TemplateListSource => ({
      templates, isLoading: false, error: null, ...over,
    })
    const single = (over: Partial<SingleTemplateSource> = {}): SingleTemplateSource => ({
      template: null, isLoading: false, error: null, ...over,
    })
    const waForm = (whatsappTemplateId: string) =>
      inlineForm({ messageType: 'wa_template', whatsappTemplateId, discountValue: '' })

    it('no template chosen → unselected, no single fetch', () => {
      expect(templateLookup(waForm(''), listOf([claimTemplate]), single())).toEqual({ status: 'unselected' })
      expect(singleTemplateIdToFetch(waForm(''), listOf([]))).toBeNull()
    })

    it('inline campaigns never fetch a single template', () => {
      expect(singleTemplateIdToFetch(inlineForm({ whatsappTemplateId: 'wa-1' }), listOf([]))).toBeNull()
    })

    it('template in the loaded list → resolved from the list, no single fetch', () => {
      const list = listOf([otherTemplate, claimTemplate])
      expect(templateLookup(waForm('wa-1'), list, single())).toEqual({ status: 'resolved', template: claimTemplate })
      expect(singleTemplateIdToFetch(waForm('wa-1'), list)).toBeNull()
    })

    it('list still loading → loading, and the single fetch waits for the list', () => {
      const list = listOf([], { isLoading: true })
      expect(templateLookup(waForm('wa-1'), list, single())).toEqual({ status: 'loading' })
      expect(singleTemplateIdToFetch(waForm('wa-1'), list)).toBeNull()
    })

    it('template not in the first page → fetched individually and resolved (claim → blocked, not unknown)', () => {
      const list = listOf([otherTemplate])
      expect(singleTemplateIdToFetch(waForm('wa-1'), list)).toBe('wa-1')
      const lookup = templateLookup(waForm('wa-1'), list, single({ template: claimTemplate }))
      expect(lookup).toEqual({ status: 'resolved', template: claimTemplate })
      expect(couponFormMode(waForm('wa-1'), lookup)).toEqual({ mode: 'blocked' })
    })

    it('the list failed but the single fetch resolves → resolved', () => {
      const list = listOf([], { error: 'boom' })
      expect(singleTemplateIdToFetch(waForm('wa-1'), list)).toBe('wa-1')
      expect(templateLookup(waForm('wa-1'), list, single({ template: claimTemplate }))).toEqual({
        status: 'resolved', template: claimTemplate,
      })
    })

    it('single fetch in flight → loading; a stale single result for another id is not used', () => {
      const list = listOf([])
      expect(templateLookup(waForm('wa-1'), list, single({ isLoading: true }))).toEqual({ status: 'loading' })
      expect(templateLookup(waForm('wa-1'), list, single({ template: otherTemplate, isLoading: true }))).toEqual({
        status: 'loading',
      })
    })

    it('single fetch failed (404 or network) → error → mode unknown/error', () => {
      const lookup = templateLookup(waForm('wa-1'), listOf([]), single({ error: 'Failed' }))
      expect(lookup).toEqual({ status: 'error' })
      expect(couponFormMode(waForm('wa-1'), lookup)).toEqual({ mode: 'unknown', pending: 'error' })
    })

    it('pickerTemplates adds a resolved template the list page did not contain, once', () => {
      const list = [otherTemplate]
      expect(pickerTemplates(list, { status: 'resolved', template: claimTemplate })).toEqual([otherTemplate, claimTemplate])
      expect(pickerTemplates(list, { status: 'resolved', template: otherTemplate })).toEqual([otherTemplate])
      expect(pickerTemplates(list, { status: 'loading' })).toBe(list)
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
