import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/whatsapp-template-repository'
)
vi.mock(
  '@/infrastructure/supabase/repositories/restaurant-repository'
)
vi.mock('@/infrastructure/kapso/template-client')

import {
  findTemplateById,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  createMetaTemplate,
  deleteMetaTemplate,
} from '@/infrastructure/kapso/template-client'
import { updateWhatsAppTemplate } from '../update-whatsapp-template'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const TEMPLATE_BASE: WhatsAppTemplate = {
  id: 'tpl-1',
  restaurantId: 'rest-1',
  metaTemplateId: null,
  name: 'welcome_msg',
  language: 'en',
  category: 'MARKETING',
  status: 'approved',
  components: [],
  parameterFormat: 'NAMED',
  rejectionReason: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

describe('updateWhatsAppTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findTemplateById).mockResolvedValue(TEMPLATE_BASE)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)
  })

  it('throws when template is not found', async () => {
    vi.mocked(findTemplateById).mockResolvedValue(null)

    await expect(
      updateWhatsAppTemplate('tpl-missing', { name: 'new_name' })
    ).rejects.toThrow('Template not found')
  })

  it('throws when updated name is invalid', async () => {
    await expect(
      updateWhatsAppTemplate('tpl-1', { name: 'INVALID' })
    ).rejects.toThrow('Invalid template name')
  })

  it('resets status to draft and returns template without Meta when no businessAccountId', async () => {
    const draftTemplate = {
      ...TEMPLATE_BASE,
      name: 'updated_name',
      status: 'draft' as const,
      metaTemplateId: null,
      rejectionReason: null,
    }
    vi.mocked(updateTemplate).mockResolvedValue(draftTemplate)

    const result = await updateWhatsAppTemplate('tpl-1', {
      name: 'updated_name',
    })

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      name: 'updated_name',
      status: 'draft',
      metaTemplateId: null,
      rejectionReason: null,
    })
    expect(result).toEqual({ template: draftTemplate })
    expect(createMetaTemplate).not.toHaveBeenCalled()
  })

  it('deletes old Meta template and resubmits when existing had metaTemplateId', async () => {
    const existingWithMeta = {
      ...TEMPLATE_BASE,
      metaTemplateId: 'old-meta-id',
    }
    vi.mocked(findTemplateById).mockResolvedValue(existingWithMeta)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(deleteMetaTemplate).mockResolvedValue(true)
    vi.mocked(createMetaTemplate).mockResolvedValue({ id: 'new-meta-id' })

    const draftTemplate = {
      ...TEMPLATE_BASE,
      status: 'draft' as const,
      metaTemplateId: null,
      rejectionReason: null,
    }
    const resubmittedTemplate = {
      ...draftTemplate,
      metaTemplateId: 'new-meta-id',
      status: 'pending' as const,
    }
    vi.mocked(updateTemplate)
      .mockResolvedValueOnce(draftTemplate)
      .mockResolvedValueOnce(resubmittedTemplate)

    const result = await updateWhatsAppTemplate('tpl-1', {
      category: 'UTILITY',
    })

    expect(deleteMetaTemplate).toHaveBeenCalledWith(
      'biz-1',
      'welcome_msg'
    )
    expect(createMetaTemplate).toHaveBeenCalledWith('biz-1', {
      name: 'welcome_msg',
      language: 'en',
      category: 'MARKETING',
      components: [],
      parameterFormat: 'NAMED',
    })
    expect(result).toEqual({ template: resubmittedTemplate })
  })
})
