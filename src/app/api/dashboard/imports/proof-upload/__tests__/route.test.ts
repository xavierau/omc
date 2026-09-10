import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/storage/consent-proof-upload', async () => {
  const actual = await vi.importActual<
    typeof import('@/infrastructure/supabase/storage/consent-proof-upload')
  >('@/infrastructure/supabase/storage/consent-proof-upload')
  return {
    ...actual,
    uploadConsentProof: vi.fn(),
  }
})

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { uploadConsentProof } from '@/infrastructure/supabase/storage/consent-proof-upload'
import { ProofUploadValidationError } from '@/infrastructure/supabase/storage/__errors__/proof-upload-errors'
import { POST } from '../route'

const RESTAURANT_ID = 'rest-1'

function multipartRequest(file: File | null): NextRequest {
  const fd = new FormData()
  if (file) fd.set('file', file)
  return new NextRequest('http://localhost/api/dashboard/imports/proof-upload', {
    method: 'POST',
    body: fd,
  })
}

function mockTenant(): void {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1',
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
}

describe('POST /api/dashboard/imports/proof-upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTenant()
    vi.mocked(uploadConsentProof).mockResolvedValue({
      storagePath: `${RESTAURANT_ID}/abc.jpg`,
      signedUrl: 'https://example.com/signed',
    })
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(
      new AuthError('Unauthorized', 401)
    )
    const r = await POST(
      multipartRequest(new File([Buffer.from('x')], 'p.jpg', { type: 'image/jpeg' }))
    )
    expect(r.status).toBe(401)
  })

  it('returns 403 when no tenant access', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(
      new AuthError('Forbidden', 403)
    )
    const r = await POST(
      multipartRequest(new File([Buffer.from('x')], 'p.jpg', { type: 'image/jpeg' }))
    )
    expect(r.status).toBe(403)
  })

  it('returns 400 when no file provided', async () => {
    const r = await POST(multipartRequest(null))
    expect(r.status).toBe(400)
  })

  it('returns 400 with reason=unsupported_mime', async () => {
    vi.mocked(uploadConsentProof).mockRejectedValueOnce(
      new ProofUploadValidationError('unsupported_mime')
    )
    const r = await POST(
      multipartRequest(new File([Buffer.from('x')], 'p.txt', { type: 'text/plain' }))
    )
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.reason).toBe('unsupported_mime')
  })

  it('returns 400 with reason=file_too_large', async () => {
    vi.mocked(uploadConsentProof).mockRejectedValueOnce(
      new ProofUploadValidationError('file_too_large')
    )
    const r = await POST(
      multipartRequest(
        new File([Buffer.alloc(10 * 1024 * 1024 + 1)], 'p.jpg', {
          type: 'image/jpeg',
        })
      )
    )
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.reason).toBe('file_too_large')
  })

  it('returns 200 with storagePath + signedUrl on success', async () => {
    const r = await POST(
      multipartRequest(
        new File([Buffer.from('hello')], 'p.jpg', { type: 'image/jpeg' })
      )
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toEqual({
      storagePath: `${RESTAURANT_ID}/abc.jpg`,
      signedUrl: 'https://example.com/signed',
    })
    expect(uploadConsentProof).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        file: expect.objectContaining({ mimeType: 'image/jpeg' }),
      })
    )
  })

  it('returns 500 on unexpected errors', async () => {
    vi.mocked(uploadConsentProof).mockRejectedValueOnce(new Error('boom'))
    const r = await POST(
      multipartRequest(
        new File([Buffer.from('x')], 'p.jpg', { type: 'image/jpeg' })
      )
    )
    expect(r.status).toBe(500)
  })
})
