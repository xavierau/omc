import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/whatsapp-template-repository'
)
vi.mock(
  '@/infrastructure/supabase/repositories/restaurant-repository'
)
vi.mock('@/infrastructure/whatsapp/templates')

import {
  findTemplateById,
  softDeleteTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { deleteMetaTemplate } from '@/infrastructure/whatsapp/templates'
import { deleteWhatsAppTemplate } from '../delete-whatsapp-template'

const TEMPLATE_BASE = {
  id: 'tpl-1',
  restaurantId: 'rest-1',
  name: 'welcome_msg',
  language: 'en',
  category: 'MARKETING' as const,
  status: 'approved' as const,
  components: [],
  parameterFormat: 'NAMED' as const,
  rejectionReason: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

describe('deleteWhatsAppTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(softDeleteTemplate).mockResolvedValue(undefined as never)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(deleteMetaTemplate).mockResolvedValue(true)
  })

  it('returns error when template not found', async () => {
    vi.mocked(findTemplateById).mockResolvedValue(null)

    const result = await deleteWhatsAppTemplate('tpl-missing')

    expect(result).toEqual({
      success: false,
      error: 'Template not found',
    })
    expect(softDeleteTemplate).not.toHaveBeenCalled()
  })

  it('soft deletes only when no metaTemplateId', async () => {
    vi.mocked(findTemplateById).mockResolvedValue({
      ...TEMPLATE_BASE,
      metaTemplateId: null,
    })

    const result = await deleteWhatsAppTemplate('tpl-1')

    expect(result).toEqual({ success: true })
    expect(softDeleteTemplate).toHaveBeenCalledWith('tpl-1')
    expect(deleteMetaTemplate).not.toHaveBeenCalled()
  })

  it('deletes from Meta then soft deletes when metaTemplateId exists', async () => {
    vi.mocked(findTemplateById).mockResolvedValue({
      ...TEMPLATE_BASE,
      metaTemplateId: 'meta-tpl-1',
    })

    const result = await deleteWhatsAppTemplate('tpl-1')

    expect(result).toEqual({ success: true })
    expect(getMetaBusinessAccountId).toHaveBeenCalledWith('rest-1')
    expect(deleteMetaTemplate).toHaveBeenCalledWith('biz-1', 'welcome_msg')
    expect(softDeleteTemplate).toHaveBeenCalledWith('tpl-1')
  })
})
