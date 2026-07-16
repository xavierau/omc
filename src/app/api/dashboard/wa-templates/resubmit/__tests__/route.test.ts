import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository')
vi.mock('@/infrastructure/whatsapp/templates')
vi.mock('@/infrastructure/whatsapp/meta/resumable-upload')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  listTemplates,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { createMetaTemplate } from '@/infrastructure/whatsapp/templates'
import { uploadHeaderMediaFromUrl } from '@/infrastructure/whatsapp/meta/resumable-upload'
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
  // Default: no Meta app credentials, so header-image minting is a skip.
  vi.mocked(uploadHeaderMediaFromUrl).mockResolvedValue({
    ok: false,
    handle: null,
    error: { title: 'meta_not_configured' },
  })
})

const IMAGE_DRAFT_COMPONENTS = [
  { type: 'HEADER' as const, format: 'IMAGE' as const, example: { header_handle: ['https://example.com/img.png'] } },
]

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

  it('persists the rejection and reports Metas real reason per draft', async () => {
    vi.mocked(createMetaTemplate).mockResolvedValue(
      failedSubmit('meta_rejected', META_REJECTION)
    )

    const res = await POST()
    const body = await res.json()

    expect(body.submitted).toEqual([
      { name: 'welcome_msg', success: false, error: META_REJECTION },
    ])
    // Without this the row stays draft with a NULL reason — the original bug.
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      status: 'rejected',
      rejectionReason: META_REJECTION,
    })
  })

  it('falls back to the error title when there are no details', async () => {
    vi.mocked(createMetaTemplate).mockResolvedValue(failedSubmit('kapso_no_api_key'))

    const res = await POST()
    const body = await res.json()

    expect(body.submitted).toEqual([
      { name: 'welcome_msg', success: false, error: 'kapso_no_api_key' },
    ])
  })

  it('does not brand a draft rejected when nothing was submitted', async () => {
    vi.mocked(createMetaTemplate).mockResolvedValue(failedSubmit('kapso_no_api_key'))

    await POST()

    expect(updateTemplate).not.toHaveBeenCalled()
  })

  it('does not brand a draft rejected on a transient submit failure', async () => {
    vi.mocked(createMetaTemplate).mockResolvedValue(
      failedSubmit('template_create_error', 'socket hang up')
    )

    const res = await POST()
    const body = await res.json()

    expect(updateTemplate).not.toHaveBeenCalled()
    expect(body.submitted[0].error).toBe('socket hang up')
  })

  it('skips submitting an image-header draft when Meta upload is unconfigured', async () => {
    vi.mocked(listTemplates).mockResolvedValue({
      templates: [draft({ components: IMAGE_DRAFT_COMPONENTS })],
      total: 1,
    })

    const res = await POST()
    const body = await res.json()

    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(updateTemplate).not.toHaveBeenCalled()
    expect(body.submitted[0].success).toBe(false)
    expect(body.submitted[0].error).toBe('Image upload is not configured')
  })

  it('mints a handle and submits an image-header draft when configured', async () => {
    vi.mocked(listTemplates).mockResolvedValue({
      templates: [draft({ components: IMAGE_DRAFT_COMPONENTS })],
      total: 1,
    })
    vi.mocked(uploadHeaderMediaFromUrl).mockResolvedValue({ ok: true, handle: '4:minted:handle' })
    vi.mocked(createMetaTemplate).mockResolvedValue(okSubmit('meta-1', 'PENDING'))

    const res = await POST()
    const body = await res.json()

    expect(uploadHeaderMediaFromUrl).toHaveBeenCalledWith('https://example.com/img.png')
    expect(createMetaTemplate).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        components: [
          { type: 'HEADER', format: 'IMAGE', example: { headerHandle: ['4:minted:handle'] } },
        ],
      })
    )
    expect(body.submitted[0].success).toBe(true)
  })
})
