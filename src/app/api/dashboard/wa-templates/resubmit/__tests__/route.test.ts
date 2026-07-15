import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository')
vi.mock('@/infrastructure/whatsapp/templates')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  listTemplates,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { createMetaTemplate } from '@/infrastructure/whatsapp/templates'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { okSubmit, failedSubmit } from '@/test-utils/template-submit-result'
import { POST } from '../route'

const META_REJECTION = 'BODY is missing expected field(s) (example) (code 100, subcode 2388043)'

function draft(overrides: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'rest-1',
    metaTemplateId: null,
    name: 'welcome_msg',
    language: 'en',
    category: 'MARKETING',
    status: 'draft',
    components: [{ type: 'BODY', text: 'Hi {{customer_name}}' }],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTenantContext).mockResolvedValue({ restaurantId: 'rest-1' } as never)
  vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
  vi.mocked(updateTemplate).mockResolvedValue(undefined as never)
  vi.mocked(listTemplates).mockResolvedValue({ templates: [draft()], total: 1 })
})

describe('POST /api/dashboard/wa-templates/resubmit', () => {
  it('submits drafts with named-param examples injected by the shared helper', async () => {
    vi.mocked(createMetaTemplate).mockResolvedValue(okSubmit('meta-1', 'PENDING'))

    const res = await POST()

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
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      metaTemplateId: 'meta-1',
      status: 'pending',
    })
    const body = await res.json()
    expect(body.submitted).toEqual([{ name: 'welcome_msg', success: true, metaId: 'meta-1' }])
  })

  it('reports Metas real reason per draft instead of a null placeholder', async () => {
    vi.mocked(createMetaTemplate).mockResolvedValue(
      failedSubmit('meta_rejected', META_REJECTION)
    )

    const res = await POST()
    const body = await res.json()

    expect(body.submitted).toEqual([
      { name: 'welcome_msg', success: false, error: META_REJECTION },
    ])
    expect(updateTemplate).not.toHaveBeenCalled()
  })

  it('falls back to the error title when there are no details', async () => {
    vi.mocked(createMetaTemplate).mockResolvedValue(failedSubmit('kapso_no_api_key'))

    const res = await POST()
    const body = await res.json()

    expect(body.submitted).toEqual([
      { name: 'welcome_msg', success: false, error: 'kapso_no_api_key' },
    ])
  })

  it('skips submitting a draft whose image header is a raw URL', async () => {
    vi.mocked(listTemplates).mockResolvedValue({
      templates: [
        draft({
          components: [
            {
              type: 'HEADER',
              format: 'IMAGE',
              example: { header_handle: ['https://example.com/img.png'] },
            },
          ],
        }),
      ],
      total: 1,
    })

    const res = await POST()
    const body = await res.json()

    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(body.submitted[0].success).toBe(false)
    expect(body.submitted[0].error).toMatch(/resumable-upload handle/)
  })
})
