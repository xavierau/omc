import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/create-whatsapp-template')
vi.mock('@/application/list-whatsapp-templates')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { createWhatsAppTemplate } from '@/application/create-whatsapp-template'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { POST } from '../route'

const TEMPLATE: WhatsAppTemplate = {
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

const META_REJECTION = 'BODY is missing expected field(s) (example) (code 100, subcode 2388043)'

function req(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/wa-templates', {
    method: 'POST',
    body: JSON.stringify({
      name: 'welcome_msg',
      language: 'en',
      category: 'MARKETING',
      components: [],
      ...body,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(getTenantContext).mockResolvedValue({ restaurantId: 'rest-1' } as never)
})

describe('POST /api/dashboard/wa-templates', () => {
  it('returns 201 with the template on success', async () => {
    vi.mocked(createWhatsAppTemplate).mockResolvedValue({ template: TEMPLATE })

    const res = await POST(req())

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(TEMPLATE)
  })

  it('returns 422 with template and error when Meta rejects', async () => {
    const rejected = { ...TEMPLATE, status: 'rejected' as const, rejectionReason: META_REJECTION }
    vi.mocked(createWhatsAppTemplate).mockResolvedValue({
      template: rejected,
      error: META_REJECTION,
      errorCode: 'meta_rejected',
    })

    const res = await POST(req())

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ template: rejected, error: META_REJECTION })
  })

  it('returns 502 when the provider is unconfigured', async () => {
    vi.mocked(createWhatsAppTemplate).mockResolvedValue({
      template: TEMPLATE,
      error: 'WhatsApp provider not configured',
      errorCode: 'provider_not_configured',
    })

    const res = await POST(req())

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      template: TEMPLATE,
      error: 'WhatsApp provider not configured',
    })
  })

  it('returns 502 on a transient provider error, not 422', async () => {
    vi.mocked(createWhatsAppTemplate).mockResolvedValue({
      template: TEMPLATE,
      error: 'socket hang up',
      errorCode: 'provider_error',
    })

    const res = await POST(req())

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ template: TEMPLATE, error: 'socket hang up' })
  })

  it('returns 400 when the use case throws a validation error', async () => {
    vi.mocked(createWhatsAppTemplate).mockRejectedValue(
      new Error('Image, video and document headers must use a Meta resumable-upload handle')
    )

    const res = await POST(req())

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Image, video and document headers must use a Meta resumable-upload handle',
    })
  })

  it('returns 400 without calling the use case when the body is invalid', async () => {
    const res = await POST(req({ name: undefined }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'name is required' })
    expect(createWhatsAppTemplate).not.toHaveBeenCalled()
  })

  it('passes an AuthError through with its status code', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Unauthorized', 401))

    const res = await POST(req())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })
})
