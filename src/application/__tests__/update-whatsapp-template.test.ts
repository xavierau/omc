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
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  createMetaTemplate,
  deleteMetaTemplate,
} from '@/infrastructure/whatsapp/templates'
import { updateWhatsAppTemplate } from '../update-whatsapp-template'
import type { WhatsAppTemplate, TemplateComponent } from '@/domain/entities/whatsapp-template'
import { isTemplateSendable } from '@/domain/entities/whatsapp-template'
import { okSubmit, failedSubmit } from '@/test-utils/template-submit-result'

const META_REJECTION =
  'Invalid parameter: BODY is missing expected field(s) (example) (code 100, subcode 2388043)'

const RAW_URL_IMAGE_HEADER: TemplateComponent[] = [
  {
    type: 'HEADER',
    format: 'IMAGE',
    example: { header_handle: ['https://example.com/img.png'] },
  },
]

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

  it('persists local changes without touching status when no businessAccountId', async () => {
    const renamed = { ...TEMPLATE_BASE, name: 'updated_name' }
    vi.mocked(updateTemplate).mockResolvedValue(renamed)

    const result = await updateWhatsAppTemplate('tpl-1', {
      name: 'updated_name',
    })

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', { name: 'updated_name' })
    expect(result).toEqual({ template: renamed })
    expect(createMetaTemplate).not.toHaveBeenCalled()
  })

  it('refuses to edit a Meta-linked template when no businessAccountId', async () => {
    // Persisting here would leave an approved row sendable with content Meta has
    // never seen. Nulling the link would orphan a live template. So: refuse.
    const linked = { ...TEMPLATE_BASE, metaTemplateId: 'old-meta-id' }
    vi.mocked(findTemplateById).mockResolvedValue(linked)

    const result = await updateWhatsAppTemplate('tpl-1', {
      components: [{ type: 'BODY', text: 'Hi {{customer_name}}' }],
    })

    expect(updateTemplate).not.toHaveBeenCalled()
    expect(result.errorCode).toBe('provider_not_configured')
    // The row is returned untouched: still approved, still linked, still matching Meta.
    expect(result.template).toEqual(linked)
    expect(isTemplateSendable(result.template)).toBe(true)
    expect(result.template.components).toEqual([])
  })

  it('deletes old Meta template and resubmits when existing had metaTemplateId', async () => {
    const existingWithMeta = {
      ...TEMPLATE_BASE,
      metaTemplateId: 'old-meta-id',
    }
    vi.mocked(findTemplateById).mockResolvedValue(existingWithMeta)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(deleteMetaTemplate).mockResolvedValue(true)
    vi.mocked(createMetaTemplate).mockResolvedValue(okSubmit('new-meta-id', 'PENDING'))

    const pendingTemplate = {
      ...TEMPLATE_BASE,
      category: 'UTILITY' as const,
      metaTemplateId: 'new-meta-id',
      status: 'pending' as const,
      rejectionReason: null,
    }
    vi.mocked(updateTemplate).mockResolvedValue(pendingTemplate)

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
      category: 'UTILITY',
      components: [],
      parameterFormat: 'NAMED',
    })
    // Single updateTemplate call with final state
    expect(updateTemplate).toHaveBeenCalledTimes(1)
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      category: 'UTILITY',
      status: 'pending',
      metaTemplateId: 'new-meta-id',
      rejectionReason: null,
    })
    expect(result).toEqual({ template: pendingTemplate })
  })

  it('submits prepared components but persists them without examples', async () => {
    vi.mocked(findTemplateById).mockResolvedValue({
      ...TEMPLATE_BASE,
      metaTemplateId: 'old-meta-id',
    })
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(deleteMetaTemplate).mockResolvedValue(true)
    vi.mocked(createMetaTemplate).mockResolvedValue(okSubmit('new-meta-id', 'PENDING'))
    vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

    await updateWhatsAppTemplate('tpl-1', {
      components: [{ type: 'BODY', text: 'Hi ｛｛customer_name｝｝' }],
    })

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
    expect(updateTemplate).toHaveBeenCalledWith(
      'tpl-1',
      expect.objectContaining({
        components: [{ type: 'BODY', text: 'Hi {{customer_name}}' }],
      })
    )
  })

  it('records the rejection honestly when Meta rejects after the delete', async () => {
    vi.mocked(findTemplateById).mockResolvedValue({
      ...TEMPLATE_BASE,
      metaTemplateId: 'old-meta-id',
    })
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(deleteMetaTemplate).mockResolvedValue(true)
    vi.mocked(createMetaTemplate).mockResolvedValue(
      failedSubmit('meta_rejected', META_REJECTION)
    )

    const rejectedTemplate = {
      ...TEMPLATE_BASE,
      category: 'UTILITY' as const,
      status: 'rejected' as const,
      metaTemplateId: null,
      rejectionReason: META_REJECTION,
    }
    vi.mocked(updateTemplate).mockResolvedValue(rejectedTemplate)

    const result = await updateWhatsAppTemplate('tpl-1', { category: 'UTILITY' })

    // The old template is genuinely gone from Meta — record that, don't pretend it's a draft.
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      category: 'UTILITY',
      status: 'rejected',
      metaTemplateId: null,
      rejectionReason: META_REJECTION,
    })
    expect(result).toEqual({
      template: rejectedTemplate,
      error: META_REJECTION,
      errorCode: 'meta_rejected',
    })
  })

  it('aborts without creating when the old Meta template cannot be deleted', async () => {
    // Creating anyway would fail on name+language uniqueness, and the failure path
    // would then null the link while the template is still live on Meta.
    const linked = { ...TEMPLATE_BASE, metaTemplateId: 'old-meta-id' }
    vi.mocked(findTemplateById).mockResolvedValue(linked)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(deleteMetaTemplate).mockResolvedValue(false)

    const result = await updateWhatsAppTemplate('tpl-1', { category: 'UTILITY' })

    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(updateTemplate).not.toHaveBeenCalled()
    expect(result.errorCode).toBe('provider_error')
    expect(result.template).toEqual(linked)
  })

  it('persists a draft edit when the provider is unconfigured', async () => {
    // No link means nothing can diverge, so the local edit is safe to keep.
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(createMetaTemplate).mockResolvedValue(failedSubmit('kapso_no_api_key'))
    vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

    const result = await updateWhatsAppTemplate('tpl-1', { category: 'UTILITY' })

    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', { category: 'UTILITY' })
    const payload = vi.mocked(updateTemplate).mock.calls[0][1]
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('rejectionReason')
    expect(result.errorCode).toBe('provider_not_configured')
  })

  it('does not brand a transient submit failure as a Meta rejection', async () => {
    vi.mocked(findTemplateById).mockResolvedValue({
      ...TEMPLATE_BASE,
      metaTemplateId: 'old-meta-id',
    })
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(deleteMetaTemplate).mockResolvedValue(true)
    vi.mocked(createMetaTemplate).mockResolvedValue(
      failedSubmit('template_create_error', 'socket hang up')
    )
    vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

    const result = await updateWhatsAppTemplate('tpl-1', { category: 'UTILITY' })

    // The delete succeeded, so the old template really is gone — unlink honestly,
    // but a network blip is not Meta refusing the content.
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      category: 'UTILITY',
      status: 'draft',
      metaTemplateId: null,
      rejectionReason: 'socket hang up',
    })
    expect(result.errorCode).toBe('provider_error')
  })

  it('rejects a raw-URL image header WITHOUT deleting the live Meta template', async () => {
    // The regression test for the destructive edit: an approved template must
    // survive a payload Meta would refuse.
    vi.mocked(findTemplateById).mockResolvedValue({
      ...TEMPLATE_BASE,
      metaTemplateId: 'old-meta-id',
    })
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')

    await expect(
      updateWhatsAppTemplate('tpl-1', { components: RAW_URL_IMAGE_HEADER })
    ).rejects.toThrow(/resumable-upload handle/)

    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(updateTemplate).not.toHaveBeenCalled()
  })
})
