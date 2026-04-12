import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/whatsapp-template-repository'
)
vi.mock(
  '@/infrastructure/supabase/repositories/restaurant-repository'
)
vi.mock('@/infrastructure/kapso/template-client')

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
} from '@/infrastructure/kapso/template-client'
import { createWhatsAppTemplate } from '../create-whatsapp-template'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

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
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue(null)
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
    vi.mocked(createMetaTemplate).mockResolvedValue({ id: 'meta-tpl-1' })
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

  it('returns template with error when Meta submission fails', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(createMetaTemplate).mockResolvedValue(null)

    const result = await createWhatsAppTemplate(VALID_PARAMS)

    expect(result).toEqual({
      template: TEMPLATE_BASE,
      error: 'Failed to submit template to Meta',
    })
  })
})
