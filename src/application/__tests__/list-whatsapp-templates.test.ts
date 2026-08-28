import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/whatsapp-template-repository'
)

import { listTemplates } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { listWhatsAppTemplates } from '../list-whatsapp-templates'

describe('listWhatsAppTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listTemplates).mockResolvedValue({
      templates: [],
      total: 0,
    })
  })

  it('passes params with defaults for page and pageSize', async () => {
    await listWhatsAppTemplates({ restaurantId: 'rest-1' })

    expect(listTemplates).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      status: undefined,
      category: undefined,
      page: 1,
      pageSize: 20,
    })
  })

  it('uses provided page and pageSize when given', async () => {
    await listWhatsAppTemplates({
      restaurantId: 'rest-1',
      page: 3,
      pageSize: 10,
    })

    expect(listTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 3,
        pageSize: 10,
      })
    )
  })
})
