import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/update-whatsapp-template', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/application/update-whatsapp-template')
  >()
  return { ...actual, updateWhatsAppTemplate: vi.fn() }
})
vi.mock('@/application/delete-whatsapp-template')
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import {
  updateWhatsAppTemplate,
  TemplateNotFoundError,
} from '@/application/update-whatsapp-template'
import { deleteWhatsAppTemplate } from '@/application/delete-whatsapp-template'
import { findTemplateByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { GET, PATCH, DELETE } from '../route'

const TEMPLATE: WhatsAppTemplate = {
  id: 'tpl-1',
  restaurantId: 'rest-1',
  metaTemplateId: 'meta-1',
  name: 'welcome_msg',
  language: 'en',
  category: 'MARKETING',
  status: 'pending',
  components: [],
  parameterFormat: 'NAMED',
  rejectionReason: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

const META_REJECTION = 'BODY is missing expected field(s) (example) (code 100, subcode 2388043)'

function req(method = 'PATCH'): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/wa-templates/tpl-1', {
    method,
    ...(method === 'PATCH' ? { body: JSON.stringify({ category: 'UTILITY' }) } : {}),
  })
}

function ctx() {
  return { params: Promise.resolve({ id: 'tpl-1' }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(getTenantContext).mockResolvedValue({ restaurantId: 'rest-1' } as never)
})

describe('GET /api/dashboard/wa-templates/[id]', () => {
  it('returns 200 with the template scoped to the caller tenant', async () => {
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(TEMPLATE)

    const res = await GET(req('GET'), ctx())

    expect(findTemplateByIdForRestaurant).toHaveBeenCalledWith('tpl-1', 'rest-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(TEMPLATE)
  })

  it('returns 404 for a template owned by another tenant', async () => {
    // Scoped lookup finds nothing, and the answer is identical to a missing id so
    // template ids stay non-enumerable.
    vi.mocked(getTenantContext).mockResolvedValue({ restaurantId: 'rest-2' } as never)
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(null)

    const res = await GET(req('GET'), ctx())

    expect(findTemplateByIdForRestaurant).toHaveBeenCalledWith('tpl-1', 'rest-2')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Template not found' })
  })

  it('propagates the guard status instead of a 500 when the tenant is forbidden', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden: no access to tenant', 403))

    const res = await GET(req('GET'), ctx())

    expect(res.status).toBe(403)
    expect(findTemplateByIdForRestaurant).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/dashboard/wa-templates/[id]', () => {
  it('returns 200 with the template on success', async () => {
    vi.mocked(updateWhatsAppTemplate).mockResolvedValue({ template: TEMPLATE })

    const res = await PATCH(req(), ctx())

    expect(updateWhatsAppTemplate).toHaveBeenCalledWith(
      'tpl-1',
      'rest-1',
      expect.objectContaining({ category: 'UTILITY' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(TEMPLATE)
  })

  it('returns 404 for a template owned by another tenant', async () => {
    vi.mocked(getTenantContext).mockResolvedValue({ restaurantId: 'rest-2' } as never)
    vi.mocked(updateWhatsAppTemplate).mockRejectedValue(new TemplateNotFoundError())

    const res = await PATCH(req(), ctx())

    expect(updateWhatsAppTemplate).toHaveBeenCalledWith(
      'tpl-1',
      'rest-2',
      expect.anything()
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Template not found' })
  })

  it('propagates the guard status instead of a 500 when the tenant is forbidden', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden: no access to tenant', 403))

    const res = await PATCH(req(), ctx())

    expect(res.status).toBe(403)
    expect(updateWhatsAppTemplate).not.toHaveBeenCalled()
  })

  it('returns 422 with template and error when Meta rejects', async () => {
    const rejected = {
      ...TEMPLATE,
      status: 'rejected' as const,
      metaTemplateId: null,
      rejectionReason: META_REJECTION,
    }
    vi.mocked(updateWhatsAppTemplate).mockResolvedValue({
      template: rejected,
      error: META_REJECTION,
      errorCode: 'meta_rejected',
    })

    const res = await PATCH(req(), ctx())

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ template: rejected, error: META_REJECTION })
  })

  it('returns 502 when the provider is unconfigured', async () => {
    vi.mocked(updateWhatsAppTemplate).mockResolvedValue({
      template: TEMPLATE,
      error: 'WhatsApp provider not configured',
      errorCode: 'provider_not_configured',
    })

    const res = await PATCH(req(), ctx())

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      template: TEMPLATE,
      error: 'WhatsApp provider not configured',
    })
  })

  it('returns 502 on a transient provider error, not 422', async () => {
    vi.mocked(updateWhatsAppTemplate).mockResolvedValue({
      template: TEMPLATE,
      error: 'socket hang up',
      errorCode: 'provider_error',
    })

    const res = await PATCH(req(), ctx())

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ template: TEMPLATE, error: 'socket hang up' })
  })

  it('returns 400 with the message when the use case throws a validation error', async () => {
    vi.mocked(updateWhatsAppTemplate).mockRejectedValue(
      new Error('Invalid template name: must be lowercase alphanumeric and underscores only')
    )

    const res = await PATCH(req(), ctx())

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Invalid template name: must be lowercase alphanumeric and underscores only',
    })
  })
})

describe('DELETE /api/dashboard/wa-templates/[id]', () => {
  it('returns 200 and passes the caller tenant to the use case', async () => {
    vi.mocked(deleteWhatsAppTemplate).mockResolvedValue({ success: true })

    const res = await DELETE(req('DELETE'), ctx())

    expect(deleteWhatsAppTemplate).toHaveBeenCalledWith('tpl-1', 'rest-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })

  it('returns 404 for a template owned by another tenant', async () => {
    vi.mocked(getTenantContext).mockResolvedValue({ restaurantId: 'rest-2' } as never)
    vi.mocked(deleteWhatsAppTemplate).mockResolvedValue({
      success: false,
      error: 'Template not found',
    })

    const res = await DELETE(req('DELETE'), ctx())

    expect(deleteWhatsAppTemplate).toHaveBeenCalledWith('tpl-1', 'rest-2')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Template not found' })
  })

  it('propagates the guard status instead of a 500 when the tenant is forbidden', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden: no access to tenant', 403))

    const res = await DELETE(req('DELETE'), ctx())

    expect(res.status).toBe(403)
    expect(deleteWhatsAppTemplate).not.toHaveBeenCalled()
  })
})
