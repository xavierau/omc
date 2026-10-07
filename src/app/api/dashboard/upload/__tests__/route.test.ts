import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/client')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { POST } from '../route'

const RESTAURANT_ID = 'r-1'

function uploadRequest(bucket: string | null, file: File | null): NextRequest {
  const fd = new FormData()
  if (file) fd.set('file', file)
  const url = bucket
    ? `http://localhost/api/dashboard/upload?bucket=${bucket}`
    : 'http://localhost/api/dashboard/upload'
  return new NextRequest(url, { method: 'POST', body: fd })
}

function mockTenant(): void {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1',
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
}

function mockStorage() {
  const upload = vi.fn().mockResolvedValue({ error: null })
  const getPublicUrl = vi
    .fn()
    .mockReturnValue({ data: { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/b/p' } })
  const from = vi.fn().mockReturnValue({ upload, getPublicUrl })
  vi.mocked(createServerSupabaseClient).mockReturnValue({
    storage: { from },
  } as unknown as ReturnType<typeof createServerSupabaseClient>)
  return { upload, getPublicUrl, from }
}

describe('POST /api/dashboard/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTenant()
  })

  it('returns 400 for an invalid bucket', async () => {
    mockStorage()
    const r = await POST(
      uploadRequest('not-a-bucket', new File([Buffer.from('x')], 'p.jpg', { type: 'image/jpeg' }))
    )
    expect(r.status).toBe(400)
  })

  it('returns 400 when no file is provided', async () => {
    mockStorage()
    const r = await POST(uploadRequest('wa-template-media', null))
    expect(r.status).toBe(400)
  })

  it('passes through AuthError status', async () => {
    mockStorage()
    vi.mocked(getTenantContext).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await POST(
      uploadRequest(
        'wa-template-media',
        new File([Buffer.from('x')], 'p.jpg', { type: 'image/jpeg' })
      )
    )
    expect(r.status).toBe(401)
  })

  it('rejects a video upload to campaign-images with the policy message', async () => {
    mockStorage()
    const r = await POST(
      uploadRequest('campaign-images', new File([Buffer.from('x')], 'v.mp4', { type: 'video/mp4' }))
    )
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toBe('Invalid file type: video/mp4. Allowed: JPEG, PNG, WebP.')
  })

  it('rejects an oversized video on wa-template-media', async () => {
    mockStorage()
    const oversized = Buffer.alloc(16 * 1024 * 1024 + 1)
    const r = await POST(
      uploadRequest('wa-template-media', new File([oversized], 'v.mp4', { type: 'video/mp4' }))
    )
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toBe('File exceeds 16MB limit.')
  })

  it('accepts a small video/3gpp upload on wa-template-media and stores it with a .3gp extension', async () => {
    const { upload } = mockStorage()
    const r = await POST(
      uploadRequest('wa-template-media', new File([Buffer.from('x')], 'v.3gp', { type: 'video/3gpp' }))
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.url).toBeDefined()
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/\.3gp$/),
      expect.anything(),
      expect.objectContaining({ contentType: 'video/3gpp' })
    )
  })
})
