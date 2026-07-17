import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/whatsapp-template-repository'
)
vi.mock(
  '@/infrastructure/supabase/repositories/restaurant-repository'
)
vi.mock('@/infrastructure/whatsapp/templates')
vi.mock('@/infrastructure/kapso/template-media-upload')

import {
  createTemplate,
  findTemplateByNameAndLanguage,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import {
  getMetaBusinessAccountId,
  getRestaurantPhoneNumberId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  createMetaTemplate,
  resolveWabaId,
} from '@/infrastructure/whatsapp/templates'
import { uploadHeaderMediaFromUrl } from '@/infrastructure/kapso/template-media-upload'
import { createWhatsAppTemplate } from '../create-whatsapp-template'
import type { WhatsAppTemplate, TemplateComponent } from '@/domain/entities/whatsapp-template'
import { okSubmit, failedSubmit } from '@/test-utils/template-submit-result'

const META_REJECTION =
  'Invalid parameter: BODY is missing expected field(s) (example) (code 100, subcode 2388043)'

const TEMPLATE_BASE: WhatsAppTemplate = {
  id: 'tpl-1',
  restaurantId: 'rest-1',
  metaTemplateId: null,
  name: 'welcome_msg',
  language: 'en',
  category: 'MARKETING',
  status: 'draft',
  components: [],
  parameterFormat: 'NAMED',
  rejectionReason: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

const VALID_PARAMS = {
  restaurantId: 'rest-1',
  name: 'welcome_msg',
  language: 'en',
  category: 'MARKETING' as const,
  components: [],
}

describe('createWhatsAppTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findTemplateByNameAndLanguage).mockResolvedValue(null)
    vi.mocked(createTemplate).mockResolvedValue(TEMPLATE_BASE)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('')
    vi.mocked(resolveWabaId).mockResolvedValue(null)
    // Default: no Meta app credentials, so header-image minting is a skip.
    vi.mocked(uploadHeaderMediaFromUrl).mockResolvedValue({
      ok: false,
      handle: null,
      error: { title: 'not_configured' },
    })
  })

  const IMAGE_URL_COMPONENTS: TemplateComponent[] = [
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://example.com/img.png'] } },
    { type: 'BODY', text: 'Body' },
  ]

  it('throws when name contains uppercase characters', async () => {
    await expect(
      createWhatsAppTemplate({ ...VALID_PARAMS, name: 'Invalid_Name' })
    ).rejects.toThrow('Invalid template name')
  })

  it('throws when template already exists', async () => {
    vi.mocked(findTemplateByNameAndLanguage).mockResolvedValue(
      TEMPLATE_BASE
    )

    await expect(
      createWhatsAppTemplate(VALID_PARAMS)
    ).rejects.toThrow('already exists')
  })

  it('returns template without Meta submission when no businessAccountId and no phoneNumberId', async () => {
    const result = await createWhatsAppTemplate(VALID_PARAMS)

    expect(result).toEqual({ template: TEMPLATE_BASE })
    expect(createMetaTemplate).not.toHaveBeenCalled()
  })

  // Real rows store '' rather than NULL for an unset WABA, and '' is not nullish —
  // so `??` would skip auto-resolution and silently leave the draft unsubmitted.
  it('auto-resolves the WABA when the stored businessAccountId is an empty string', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('')
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-1')
    vi.mocked(resolveWabaId).mockResolvedValue('resolved-waba')
    vi.mocked(createMetaTemplate).mockResolvedValue(okSubmit('meta-1'))
    vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

    await createWhatsAppTemplate(VALID_PARAMS)

    expect(resolveWabaId).toHaveBeenCalledWith('phone-1')
    expect(updateMetaBusinessAccountId).toHaveBeenCalledWith('rest-1', 'resolved-waba')
    expect(createMetaTemplate).toHaveBeenCalledWith(
      'resolved-waba',
      expect.anything()
    )
  })

  it('submits to Meta and updates status to pending when businessAccountId is available', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(createMetaTemplate).mockResolvedValue(okSubmit('meta-tpl-1', 'PENDING'))
    const pendingTemplate = {
      ...TEMPLATE_BASE,
      metaTemplateId: 'meta-tpl-1',
      status: 'pending' as const,
    }
    vi.mocked(updateTemplate).mockResolvedValue(pendingTemplate)

    const result = await createWhatsAppTemplate(VALID_PARAMS)

    expect(createMetaTemplate).toHaveBeenCalledWith('biz-1', {
      name: 'welcome_msg',
      language: 'en',
      category: 'MARKETING',
      components: [],
      parameterFormat: 'NAMED',
    })
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      metaTemplateId: 'meta-tpl-1',
      status: 'pending',
    })
    expect(result).toEqual({ template: pendingTemplate })
  })

  it('records the rejection and surfaces Metas reason when Meta rejects', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(createMetaTemplate).mockResolvedValue(
      failedSubmit('meta_rejected', META_REJECTION)
    )
    const rejectedTemplate = {
      ...TEMPLATE_BASE,
      status: 'rejected' as const,
      rejectionReason: META_REJECTION,
    }
    vi.mocked(updateTemplate).mockResolvedValue(rejectedTemplate)

    const result = await createWhatsAppTemplate(VALID_PARAMS)

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      status: 'rejected',
      rejectionReason: META_REJECTION,
    })
    expect(result).toEqual({
      template: rejectedTemplate,
      error: META_REJECTION,
      errorCode: 'meta_rejected',
    })
  })

  it('does not record a rejection when the provider is unconfigured', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(createMetaTemplate).mockResolvedValue(failedSubmit('kapso_no_api_key'))

    const result = await createWhatsAppTemplate(VALID_PARAMS)

    // Nothing was ever submitted, so the row must not be branded rejected.
    expect(updateTemplate).not.toHaveBeenCalled()
    expect(result).toEqual({
      template: TEMPLATE_BASE,
      error: 'WhatsApp provider not configured',
      errorCode: 'provider_not_configured',
    })
  })

  it('does not brand a transient submit failure as a Meta rejection', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(createMetaTemplate).mockResolvedValue(
      failedSubmit('template_create_error', 'socket hang up')
    )

    const result = await createWhatsAppTemplate(VALID_PARAMS)

    // A network blip is not Meta refusing the content: leave the draft alone so the
    // operator retries instead of hunting for a content problem that doesn't exist.
    expect(updateTemplate).not.toHaveBeenCalled()
    expect(result).toEqual({
      template: TEMPLATE_BASE,
      error: 'socket hang up',
      errorCode: 'provider_error',
    })
  })

  it('persists components without examples but submits them with examples', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(createMetaTemplate).mockResolvedValue(okSubmit('meta-tpl-1', 'PENDING'))
    vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)
    const components: TemplateComponent[] = [{ type: 'BODY', text: 'Hi {{customer_name}}' }]

    await createWhatsAppTemplate({ ...VALID_PARAMS, components })

    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ components: [{ type: 'BODY', text: 'Hi {{customer_name}}' }] })
    )
    expect(createMetaTemplate).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        components: [
          {
            type: 'BODY',
            text: 'Hi {{customer_name}}',
            example: { bodyTextNamedParams: [{ paramName: 'customer_name', example: 'John' }] },
          },
        ],
      })
    )
  })

  it('persists full-width braces normalized to ASCII', async () => {
    const components: TemplateComponent[] = [{ type: 'BODY', text: 'Hi ｛｛customer_name｝｝' }]

    await createWhatsAppTemplate({ ...VALID_PARAMS, components })

    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ components: [{ type: 'BODY', text: 'Hi {{customer_name}}' }] })
    )
  })

  it('saves a raw-URL image header as a draft when there is no WABA, deferring the mint', async () => {
    const result = await createWhatsAppTemplate({ ...VALID_PARAMS, components: IMAGE_URL_COMPONENTS })

    // No WABA → not submitted; the URL is preserved for a later resubmit.
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ components: IMAGE_URL_COMPONENTS })
    )
    expect(uploadHeaderMediaFromUrl).not.toHaveBeenCalled()
    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(result).toEqual({ template: TEMPLATE_BASE })
  })

  it('mints a Meta handle for a URL image header and submits it when configured', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-1')
    vi.mocked(uploadHeaderMediaFromUrl).mockResolvedValue({ ok: true, handle: '4:minted:handle' })
    vi.mocked(createMetaTemplate).mockResolvedValue(okSubmit('meta-tpl-1', 'PENDING'))
    vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

    await createWhatsAppTemplate({ ...VALID_PARAMS, components: IMAGE_URL_COMPONENTS })

    expect(uploadHeaderMediaFromUrl).toHaveBeenCalledWith('phone-1', 'https://example.com/img.png')
    // Submitted with the minted handle (camelCased for the wire), not the URL.
    expect(createMetaTemplate).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        components: expect.arrayContaining([
          expect.objectContaining({
            type: 'HEADER',
            format: 'IMAGE',
            example: { headerHandle: ['4:minted:handle'] },
          }),
        ]),
      })
    )
    // The stored draft still holds the URL.
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ components: IMAGE_URL_COMPONENTS })
    )
  })

  it('refuses to submit a URL image header when Meta upload is unconfigured', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    // uploadHeaderMediaFromUrl defaults to not_configured.

    const result = await createWhatsAppTemplate({ ...VALID_PARAMS, components: IMAGE_URL_COMPONENTS })

    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(result).toEqual({
      template: TEMPLATE_BASE,
      error: 'Image upload is not configured',
      errorCode: 'provider_not_configured',
    })
  })

  it('surfaces a Meta upload failure as a provider_error without submitting', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(uploadHeaderMediaFromUrl).mockResolvedValue({
      ok: false,
      handle: null,
      error: { title: 'upload_failed', details: 'Meta upload failed (400)' },
    })

    const result = await createWhatsAppTemplate({ ...VALID_PARAMS, components: IMAGE_URL_COMPONENTS })

    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(result).toEqual({
      template: TEMPLATE_BASE,
      error: 'Meta upload failed (400)',
      errorCode: 'provider_error',
    })
  })
})
