import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/whatsapp-template-repository'
)
vi.mock(
  '@/infrastructure/supabase/repositories/restaurant-repository'
)
vi.mock('@/infrastructure/whatsapp/templates')

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
  })

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

  it('rejects a raw-URL image header before creating any row', async () => {
    const components: TemplateComponent[] = [
      {
        type: 'HEADER',
        format: 'IMAGE',
        example: { header_handle: ['https://example.com/img.png'] },
      },
    ]

    await expect(
      createWhatsAppTemplate({ ...VALID_PARAMS, components })
    ).rejects.toThrow(/resumable-upload handle/)
    expect(createTemplate).not.toHaveBeenCalled()
    expect(createMetaTemplate).not.toHaveBeenCalled()
  })
})
