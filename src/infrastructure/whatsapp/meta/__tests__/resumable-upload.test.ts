import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { uploadHeaderMediaFromUrl } from '@/infrastructure/whatsapp/meta/resumable-upload'

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>
}

function bytesResponse(bytes: number, contentType = 'image/jpeg') {
  return {
    ok: true,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => new ArrayBuffer(bytes),
  }
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body, text: async () => JSON.stringify(body) }
}

const IMAGE_URL = 'https://cdn.example.com/restaurant/123/header.jpg'

describe('uploadHeaderMediaFromUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('META_APP_ID', 'app-123')
    vi.stubEnv('META_ACCESS_TOKEN', 'sys-token-xyz')
    vi.stubEnv('META_GRAPH_VERSION', 'v21.0')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('skips with meta_not_configured when the app id is missing (never fetches)', async () => {
    vi.stubEnv('META_APP_ID', '')

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result).toEqual({ ok: false, handle: null, error: { title: 'meta_not_configured' } })
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('skips with meta_not_configured when the access token is missing', async () => {
    vi.stubEnv('META_ACCESS_TOKEN', '')

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result.error?.title).toBe('meta_not_configured')
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('returns fetch_failed when the source image cannot be read', async () => {
    fetchMock().mockResolvedValueOnce({ ok: false, status: 404 })

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('fetch_failed')
  })

  it('creates an upload session then uploads the bytes and returns the handle', async () => {
    fetchMock()
      .mockResolvedValueOnce(bytesResponse(2048, 'image/png'))
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:SESSION123' }))
      .mockResolvedValueOnce(jsonResponse({ h: '4:handle:abc' }))

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result).toEqual({ ok: true, handle: '4:handle:abc' })

    // session creation: app-scoped /uploads with file metadata + OAuth auth
    const sessionCall = fetchMock().mock.calls[1]
    expect(sessionCall[0]).toContain('/v21.0/app-123/uploads')
    expect(sessionCall[0]).toContain('file_length=2048')
    expect(sessionCall[0]).toContain('file_type=image%2Fpng')
    expect(sessionCall[1]).toMatchObject({ method: 'POST' })
    expect(sessionCall[1].headers.Authorization).toBe('OAuth sys-token-xyz')

    // byte upload: posts to the returned session id with file_offset 0
    const uploadCall = fetchMock().mock.calls[2]
    expect(uploadCall[0]).toContain('/v21.0/upload:SESSION123')
    expect(uploadCall[1].headers.Authorization).toBe('OAuth sys-token-xyz')
    expect(uploadCall[1].headers.file_offset).toBe('0')
  })

  it('returns upload_failed when the session cannot be created', async () => {
    fetchMock()
      .mockResolvedValueOnce(bytesResponse(2048))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'bad app' } }, false))

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('upload_failed')
  })

  it('returns upload_failed when the upload response carries no handle', async () => {
    fetchMock()
      .mockResolvedValueOnce(bytesResponse(2048))
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:SESSION123' }))
      .mockResolvedValueOnce(jsonResponse({ nothing: true }))

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('upload_failed')
  })
})
