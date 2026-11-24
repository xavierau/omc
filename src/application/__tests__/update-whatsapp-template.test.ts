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
  findTemplateByIdForRestaurant,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import {
  getMetaBusinessAccountId,
  getRestaurantPhoneNumberId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  createMetaTemplate,
  deleteMetaTemplate,
  editMetaTemplate,
} from '@/infrastructure/whatsapp/templates'
import { uploadHeaderMediaFromUrl } from '@/infrastructure/kapso/template-media-upload'
import {
  updateWhatsAppTemplate,
  TemplateNotFoundError,
  TemplateEditRefusedError,
} from '../update-whatsapp-template'
import type { WhatsAppTemplate, TemplateComponent } from '@/domain/entities/whatsapp-template'
import { isTemplateSendable } from '@/domain/entities/whatsapp-template'
import { okSubmit, failedSubmit } from '@/test-utils/template-submit-result'

const META_REJECTION =
  'Invalid parameter: BODY is missing expected field(s) (example) (code 100, subcode 2388043)'

// Illustrative: Meta documents the limit (1 edit / 24h, 10 / 30 days for an APPROVED
// template) but not its error text; the shape is what describeGraphError produces.
const META_EDIT_LIMIT =
  'Invalid parameter — Message template edit limit reached: an approved template can be edited once in 24 hours (code 100, subcode 2388299)'

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
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(TEMPLATE_BASE)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)
    // Default: no Meta app credentials, so header-image minting is a skip.
    vi.mocked(uploadHeaderMediaFromUrl).mockResolvedValue({
      ok: false,
      handle: null,
      error: { title: 'not_configured' },
    })
  })

  it('throws TemplateNotFoundError when template is not found', async () => {
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(null)

    await expect(
      updateWhatsAppTemplate('tpl-missing', 'rest-1', { name: 'new_name' })
    ).rejects.toThrow(TemplateNotFoundError)
  })

  it('scopes the lookup by restaurant so another tenant cannot edit the row', async () => {
    // The scoped lookup finds nothing for a foreign id, so the victim's live Meta
    // template is never deleted and never re-created with the caller's payload.
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(null)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')

    await expect(
      updateWhatsAppTemplate('tpl-of-rest-1', 'rest-2', { category: 'UTILITY' })
    ).rejects.toThrow(TemplateNotFoundError)

    expect(findTemplateByIdForRestaurant).toHaveBeenCalledWith(
      'tpl-of-rest-1',
      'rest-2'
    )
    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    expect(editMetaTemplate).not.toHaveBeenCalled()
    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(updateTemplate).not.toHaveBeenCalled()
  })

  it('throws when updated name is invalid', async () => {
    await expect(
      updateWhatsAppTemplate('tpl-1', 'rest-1', { name: 'INVALID' })
    ).rejects.toThrow('Invalid template name')
  })

  it('persists local changes without touching status when no businessAccountId', async () => {
    const renamed = { ...TEMPLATE_BASE, name: 'updated_name' }
    vi.mocked(updateTemplate).mockResolvedValue(renamed)

    const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', {
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
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(linked)

    const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', {
      components: [{ type: 'BODY', text: 'Hi {{customer_name}}' }],
    })

    expect(updateTemplate).not.toHaveBeenCalled()
    expect(result.errorCode).toBe('provider_not_configured')
    // The row is returned untouched: still approved, still linked, still matching Meta.
    expect(result.template).toEqual(linked)
    expect(isTemplateSendable(result.template)).toBe(true)
    expect(result.template.components).toEqual([])
  })

  it('edits a linked approved template in place on Meta and never deletes it (TPL-012)', async () => {
    // Prod 2026-11-24: the old delete-then-recreate destroyed nov_promo_v3 because
    // Meta locks a deleted name+language for ~4 weeks. Edit in place instead.
    const linked = { ...TEMPLATE_BASE, metaTemplateId: 'live-meta-id' }
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(linked)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(editMetaTemplate).mockResolvedValue(okSubmit('live-meta-id', null as never))
    const pending = { ...linked, status: 'pending' as const }
    vi.mocked(updateTemplate).mockResolvedValue(pending)

    const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', {
      name: 'welcome_msg',
      language: 'en',
      category: 'MARKETING',
      components: [{ type: 'BODY', text: 'Hi' }],
    })

    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(editMetaTemplate).toHaveBeenCalledTimes(1)
    // Unchanged category is not sent: an approved template's category is locked.
    expect(editMetaTemplate).toHaveBeenCalledWith('biz-1', 'live-meta-id', {
      components: [{ type: 'BODY', text: 'Hi' }],
    })
    expect(updateTemplate).toHaveBeenCalledTimes(1)
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      name: 'welcome_msg',
      language: 'en',
      category: 'MARKETING',
      components: [{ type: 'BODY', text: 'Hi' }],
      status: 'pending',
      metaTemplateId: 'live-meta-id',
      rejectionReason: null,
    })
    expect(result).toEqual({ template: pending })
  })

  it('sends a changed category in the edit body for a linked REJECTED template', async () => {
    const linked = { ...TEMPLATE_BASE, status: 'rejected' as const, metaTemplateId: 'live-meta-id', rejectionReason: 'x' }
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(linked)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(editMetaTemplate).mockResolvedValue(okSubmit('live-meta-id'))
    vi.mocked(updateTemplate).mockResolvedValue(linked)

    await updateWhatsAppTemplate('tpl-1', 'rest-1', { category: 'UTILITY' })

    expect(editMetaTemplate).toHaveBeenCalledWith('biz-1', 'live-meta-id', {
      components: [],
      category: 'UTILITY',
    })
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      category: 'UTILITY',
      status: 'pending',
      metaTemplateId: 'live-meta-id',
      rejectionReason: null,
    })
  })

  it('submits prepared components but persists them without examples', async () => {
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
      ...TEMPLATE_BASE,
      metaTemplateId: 'live-meta-id',
    })
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(editMetaTemplate).mockResolvedValue(okSubmit('live-meta-id'))
    vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

    await updateWhatsAppTemplate('tpl-1', 'rest-1', {
      components: [{ type: 'BODY', text: 'Hi ｛｛customer_name｝｝' }],
    })

    expect(editMetaTemplate).toHaveBeenCalledWith('biz-1', 'live-meta-id', {
      components: [
        {
          type: 'BODY',
          text: 'Hi {{customer_name}}',
          example: { bodyTextNamedParams: [{ paramName: 'customer_name', example: 'John' }] },
        },
      ],
    })
    expect(updateTemplate).toHaveBeenCalledWith(
      'tpl-1',
      expect.objectContaining({
        components: [{ type: 'BODY', text: 'Hi {{customer_name}}' }],
      })
    )
  })

  describe('a failed in-place edit persists nothing and keeps the live template', () => {
    const linked = { ...TEMPLATE_BASE, metaTemplateId: 'live-meta-id' }

    beforeEach(() => {
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(linked)
      vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    })

    it('Meta refuses the edit (24h edit limit)', async () => {
      vi.mocked(editMetaTemplate).mockResolvedValue(failedSubmit('meta_rejected', META_EDIT_LIMIT))

      const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', {
        components: [{ type: 'BODY', text: 'New copy' }],
      })

      expect(updateTemplate).not.toHaveBeenCalled()
      expect(deleteMetaTemplate).not.toHaveBeenCalled()
      expect(createMetaTemplate).not.toHaveBeenCalled()
      expect(result.template).toEqual(linked)
      expect(isTemplateSendable(result.template)).toBe(true)
      expect(result.errorCode).toBe('meta_rejected')
      expect(result.error).toContain(META_EDIT_LIMIT)
    })

    it('Meta rejects the content', async () => {
      vi.mocked(editMetaTemplate).mockResolvedValue(failedSubmit('meta_rejected', META_REJECTION))

      const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', { components: [{ type: 'BODY', text: 'x' }] })

      expect(updateTemplate).not.toHaveBeenCalled()
      expect(result.template).toEqual(linked)
      expect(result.errorCode).toBe('meta_rejected')
      expect(result.error).toContain(META_REJECTION)
    })

    it('a transient provider failure is not branded a Meta rejection', async () => {
      vi.mocked(editMetaTemplate).mockResolvedValue(failedSubmit('template_create_error', 'socket hang up'))

      // A real change: an unchanged save is a no-op since r2 and never reaches Meta.
      const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', {
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'New copy' }],
      })

      expect(updateTemplate).not.toHaveBeenCalled()
      expect(result.template).toEqual(linked)
      expect(result.errorCode).toBe('provider_error')
      expect(result.error).toContain('socket hang up')
    })

    it('no Kapso key: nothing submitted, nothing saved', async () => {
      vi.mocked(editMetaTemplate).mockResolvedValue(failedSubmit('kapso_no_api_key'))

      const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', { components: [{ type: 'BODY', text: 'New copy' }] })

      expect(updateTemplate).not.toHaveBeenCalled()
      expect(result.template).toEqual(linked)
      expect(result.errorCode).toBe('provider_not_configured')
    })
  })

  describe('refuses edits Meta cannot make in place, before any Meta call', () => {
    const linked = { ...TEMPLATE_BASE, metaTemplateId: 'live-meta-id' }

    beforeEach(() => {
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(linked)
      vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    })

    function expectNoSideEffects() {
      expect(editMetaTemplate).not.toHaveBeenCalled()
      expect(deleteMetaTemplate).not.toHaveBeenCalled()
      expect(createMetaTemplate).not.toHaveBeenCalled()
      expect(uploadHeaderMediaFromUrl).not.toHaveBeenCalled()
      expect(updateTemplate).not.toHaveBeenCalled()
    }

    const cases: Array<[string, Partial<WhatsAppTemplate>, Record<string, unknown>, RegExp]> = [
      ['a name change', {}, { name: 'welcome_msg_v2' }, /name.*create a new template/i],
      ['a language change', {}, { language: 'zh_HK' }, /language.*create a new template/i],
      ['a category change on an approved template', {}, { category: 'UTILITY' }, /category of an approved template/i],
      ['any edit while Meta is reviewing it', { status: 'pending' }, { components: [] }, /under review/i],
    ]

    it.each(cases)('%s', async (_label, rowOverrides, input, message) => {
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({ ...linked, ...rowOverrides })

      const attempt = updateWhatsAppTemplate('tpl-1', 'rest-1', input)

      await expect(attempt).rejects.toThrow(TemplateEditRefusedError)
      await expect(attempt).rejects.toThrow(message)
      expectNoSideEffects()
    })

    it('gives each refusal a distinct message', async () => {
      const messages = new Set<string>()
      for (const [, rowOverrides, input] of cases) {
        vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({ ...linked, ...rowOverrides })
        const err = await updateWhatsAppTemplate('tpl-1', 'rest-1', input).catch((e: Error) => e)
        messages.add((err as Error).message)
      }
      expect(messages.size).toBe(cases.length)
    })
  })

  // TPL-012 r2 (review finding 2): the dashboard always PATCHes the full form, and
  // an approved template may be edited on Meta once per 24h. An unchanged save
  // must not spend that edit or flip the row to pending.
  describe('a no-op edit of a linked row touches nothing', () => {
    const BODY: TemplateComponent[] = [{ type: 'BODY', text: 'Hi {{customer_name}}' }]
    const linked = { ...TEMPLATE_BASE, metaTemplateId: 'live-meta-id', components: BODY }

    beforeEach(() => {
      vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
      vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-1')
      vi.mocked(uploadHeaderMediaFromUrl).mockResolvedValue({ ok: true, handle: '4:minted:handle' })
      vi.mocked(editMetaTemplate).mockResolvedValue(okSubmit('live-meta-id'))
      vi.mocked(updateTemplate).mockResolvedValue({ ...linked, status: 'pending' })
    })

    function expectUntouched() {
      expect(editMetaTemplate).not.toHaveBeenCalled()
      expect(createMetaTemplate).not.toHaveBeenCalled()
      expect(deleteMetaTemplate).not.toHaveBeenCalled()
      expect(uploadHeaderMediaFromUrl).not.toHaveBeenCalled()
      expect(updateTemplate).not.toHaveBeenCalled()
    }

    it('full-form PATCH with identical (structurally equal, not same-reference) content', async () => {
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(linked)

      const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', {
        name: 'welcome_msg',
        language: 'en',
        category: 'MARKETING',
        components: structuredClone(BODY),
      })

      expectUntouched()
      expect(result).toEqual({ template: linked })
      expect(result.template.status).toBe('approved')
    })

    it('full-width braces that normalize to the stored text are still a no-op', async () => {
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(linked)

      const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', {
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Hi ｛｛customer_name｝｝' }],
      })

      expectUntouched()
      expect(result).toEqual({ template: linked })
    })

    it('a header-image URL row compares by the stored URL, not the minted handle', async () => {
      const imageRow = { ...linked, components: [...RAW_URL_IMAGE_HEADER, ...BODY] }
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(imageRow)

      const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', {
        name: 'welcome_msg',
        language: 'en',
        category: 'MARKETING',
        components: structuredClone(imageRow.components),
      })

      expectUntouched()
      expect(result).toEqual({ template: imageRow })
    })

    it('a one-character body change still edits on Meta', async () => {
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(linked)

      await updateWhatsAppTemplate('tpl-1', 'rest-1', {
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Hi {{customer_name}}!' }],
      })

      expect(editMetaTemplate).toHaveBeenCalledTimes(1)
      expect(updateTemplate).toHaveBeenCalledWith(
        'tpl-1',
        expect.objectContaining({ status: 'pending', metaTemplateId: 'live-meta-id' })
      )
    })

    it('a category change on a linked rejected row still edits on Meta', async () => {
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({ ...linked, status: 'rejected' })

      await updateWhatsAppTemplate('tpl-1', 'rest-1', { category: 'UTILITY', components: structuredClone(BODY) })

      expect(editMetaTemplate).toHaveBeenCalledTimes(1)
    })
  })

  // TPL-012 r2 (review finding 4): Meta cannot edit a disabled template; paused
  // and rejected templates are documented as editable.
  describe('status gate for in-place edits', () => {
    const linked = { ...TEMPLATE_BASE, metaTemplateId: 'live-meta-id' }
    const EDIT = { components: [{ type: 'BODY', text: 'New copy' }] as TemplateComponent[] }

    beforeEach(() => {
      vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
      vi.mocked(editMetaTemplate).mockResolvedValue(okSubmit('live-meta-id'))
      vi.mocked(updateTemplate).mockResolvedValue(linked)
    })

    it('refuses a disabled row with a create-a-new-template message and no Meta call', async () => {
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({ ...linked, status: 'disabled' })

      const attempt = updateWhatsAppTemplate('tpl-1', 'rest-1', EDIT)

      await expect(attempt).rejects.toThrow(TemplateEditRefusedError)
      await expect(attempt).rejects.toThrow(/disabled.*create a new template/i)
      expect(editMetaTemplate).not.toHaveBeenCalled()
      expect(createMetaTemplate).not.toHaveBeenCalled()
      expect(deleteMetaTemplate).not.toHaveBeenCalled()
      expect(updateTemplate).not.toHaveBeenCalled()
    })

    it.each(['paused', 'rejected'] as const)('a %s row still reaches editMetaTemplate', async (status) => {
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({ ...linked, status })

      await updateWhatsAppTemplate('tpl-1', 'rest-1', EDIT)

      expect(editMetaTemplate).toHaveBeenCalledTimes(1)
    })
  })

  // TPL-012 r2 (review finding 1): once Meta accepted the edit, a DB failure must
  // not read as "nothing saved" — WhatsApp already has the new content.
  describe('Meta accepted the edit but the row could not be saved', () => {
    const linked = { ...TEMPLATE_BASE, metaTemplateId: 'live-meta-id' }

    beforeEach(() => {
      vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(linked)
      vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
      vi.mocked(editMetaTemplate).mockResolvedValue(okSubmit('live-meta-id'))
      vi.mocked(updateTemplate).mockRejectedValue(new Error('connection terminated'))
    })

    it('returns the existing row with a distinct code instead of throwing', async () => {
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', {
        components: [{ type: 'BODY', text: 'New copy' }],
      })

      expect(result.template).toEqual(linked)
      expect(result.errorCode).toBe('meta_edited_not_saved')
      expect(result.error).toMatch(/WhatsApp already has/i)
      expect(result.error).toMatch(/not save/i)
      expect(editMetaTemplate).toHaveBeenCalledTimes(1)
      expect(deleteMetaTemplate).not.toHaveBeenCalled()
      expect(createMetaTemplate).not.toHaveBeenCalled()
      const logged = JSON.stringify(errorLog.mock.calls)
      expect(logged).toContain('live-meta-id')
      expect(logged).toContain('rest-1')
      expect(logged).toContain('tpl-1')
      errorLog.mockRestore()
    })
  })

  it('persists a draft edit when the provider is unconfigured', async () => {
    // No link means nothing can diverge, so the local edit is safe to keep.
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(createMetaTemplate).mockResolvedValue(failedSubmit('kapso_no_api_key'))
    vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

    const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', { category: 'UTILITY' })

    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', { category: 'UTILITY' })
    const payload = vi.mocked(updateTemplate).mock.calls[0][1]
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('rejectionReason')
    expect(result.errorCode).toBe('provider_not_configured')
  })

  it('refuses a URL image header WITHOUT touching the live Meta template when upload is unconfigured', async () => {
    // The regression test for the destructive edit: an approved template must
    // survive when the header image cannot be minted (here: no Meta credentials).
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
      ...TEMPLATE_BASE,
      metaTemplateId: 'old-meta-id',
    })
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')

    const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', { components: RAW_URL_IMAGE_HEADER })

    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    expect(editMetaTemplate).not.toHaveBeenCalled()
    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(updateTemplate).not.toHaveBeenCalled()
    expect(result.errorCode).toBe('provider_not_configured')
    expect(result.template.metaTemplateId).toBe('old-meta-id')
  })

  it('keeps an UNLINKED draft as a draft when the header image cannot be minted', async () => {
    // metaTemplateId: null → no live template to protect, but the image URL still
    // cannot be submitted unconfigured, so it must not reach Meta.
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({ ...TEMPLATE_BASE, metaTemplateId: null })
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    // uploadHeaderMediaFromUrl defaults to not_configured.

    const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', { components: RAW_URL_IMAGE_HEADER })

    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(updateTemplate).not.toHaveBeenCalled()
    expect(result.errorCode).toBe('provider_not_configured')
  })

  it('aborts BEFORE the edit when the header image upload fails', async () => {
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
      ...TEMPLATE_BASE,
      metaTemplateId: 'old-meta-id',
    })
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(uploadHeaderMediaFromUrl).mockResolvedValue({
      ok: false,
      handle: null,
      error: { title: 'upload_failed', details: 'Meta upload failed (400)' },
    })

    const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', { components: RAW_URL_IMAGE_HEADER })

    // Live template survives: no Meta call, no local write.
    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    expect(editMetaTemplate).not.toHaveBeenCalled()
    expect(updateTemplate).not.toHaveBeenCalled()
    expect(result.errorCode).toBe('provider_error')
    expect(result.error).toBe('Meta upload failed (400)')
  })

  it('mints the handle and edits an image header in place when configured', async () => {
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
      ...TEMPLATE_BASE,
      metaTemplateId: 'old-meta-id',
    })
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-1')
    vi.mocked(uploadHeaderMediaFromUrl).mockResolvedValue({ ok: true, handle: '4:minted:handle' })
    vi.mocked(editMetaTemplate).mockResolvedValue(okSubmit('old-meta-id'))
    vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

    await updateWhatsAppTemplate('tpl-1', 'rest-1', { components: RAW_URL_IMAGE_HEADER })

    expect(uploadHeaderMediaFromUrl).toHaveBeenCalledWith('phone-1', 'https://example.com/img.png')
    expect(deleteMetaTemplate).not.toHaveBeenCalled()
    // Submitted with the minted handle, not the URL.
    expect(editMetaTemplate).toHaveBeenCalledWith('biz-1', 'old-meta-id', {
      components: [
        {
          type: 'HEADER',
          format: 'IMAGE',
          example: { headerHandle: ['4:minted:handle'] },
        },
      ],
    })
    // The stored row keeps the URL, not the ephemeral handle.
    const persisted = vi.mocked(updateTemplate).mock.calls[0][1]
    expect(persisted.components).toEqual(RAW_URL_IMAGE_HEADER)
  })

  describe('unlinked row: create path unchanged', () => {
    beforeEach(() => {
      vi.mocked(getMetaBusinessAccountId).mockResolvedValue('biz-1')
    })

    it('submits a fresh create and links the new Meta id', async () => {
      vi.mocked(createMetaTemplate).mockResolvedValue(okSubmit('new-meta-id', 'PENDING'))
      vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

      await updateWhatsAppTemplate('tpl-1', 'rest-1', { name: 'renamed_draft', category: 'UTILITY' })

      expect(editMetaTemplate).not.toHaveBeenCalled()
      expect(deleteMetaTemplate).not.toHaveBeenCalled()
      expect(createMetaTemplate).toHaveBeenCalledWith('biz-1', {
        name: 'renamed_draft',
        language: 'en',
        category: 'UTILITY',
        components: [],
        parameterFormat: 'NAMED',
      })
      expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
        name: 'renamed_draft',
        category: 'UTILITY',
        status: 'pending',
        metaTemplateId: 'new-meta-id',
        rejectionReason: null,
      })
    })

    it('records a Meta rejection of the create', async () => {
      vi.mocked(createMetaTemplate).mockResolvedValue(failedSubmit('meta_rejected', META_REJECTION))
      vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

      const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', { category: 'UTILITY' })

      expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
        category: 'UTILITY',
        status: 'rejected',
        metaTemplateId: null,
        rejectionReason: META_REJECTION,
      })
      expect(result.errorCode).toBe('meta_rejected')
    })

    it('keeps a transient create failure as a draft, not a rejection', async () => {
      vi.mocked(createMetaTemplate).mockResolvedValue(failedSubmit('template_create_error', 'socket hang up'))
      vi.mocked(updateTemplate).mockResolvedValue(TEMPLATE_BASE)

      const result = await updateWhatsAppTemplate('tpl-1', 'rest-1', { category: 'UTILITY' })

      expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
        category: 'UTILITY',
        status: 'draft',
        metaTemplateId: null,
        rejectionReason: 'socket hang up',
      })
      expect(result.errorCode).toBe('provider_error')
    })
  })
})
