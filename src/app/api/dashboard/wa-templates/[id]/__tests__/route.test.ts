import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/update-whatsapp-template')
vi.mock('@/application/delete-whatsapp-template')
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { updateWhatsAppTemplate } from '@/application/update-whatsapp-template'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { PATCH } from '../route'

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

function req(): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/wa-templates/tpl-1', {
    method: 'PATCH',
    body: JSON.stringify({ category: 'UTILITY' }),
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

describe('PATCH /api/dashboard/wa-templates/[id]', () => {
  it('returns 200 with the template on success', async () => {
    vi.mocked(updateWhatsAppTemplate).mockResolvedValue({ template: TEMPLATE })

    const res = await PATCH(req(), ctx())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(TEMPLATE)
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
      new Error('Image, video and document headers must use a Meta resumable-upload handle')
    )

    const res = await PATCH(req(), ctx())

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Image, video and document headers must use a Meta resumable-upload handle',
    })
  })
})
