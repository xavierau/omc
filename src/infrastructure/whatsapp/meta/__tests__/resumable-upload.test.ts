import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { uploadHeaderMediaFromUrl } from '@/infrastructure/whatsapp/meta/resumable-upload'

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>
}

function bytesResponse(bytes: number, contentType = 'image/jpeg') {
  const headers = new Map<string, string>([
    ['content-type', contentType],
    ['content-length', String(bytes)],
  ])
  return {
    ok: true,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body: null, // forces the arrayBuffer fallback path in readCapped
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
    // No configured Supabase host → the guard falls back to private-address
    // blocking, and a public host like cdn.example.com is allowed.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
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

  it('refuses a non-https URL without touching the network (SSRF guard)', async () => {
    const result = await uploadHeaderMediaFromUrl('http://cdn.example.com/x.jpg')

    expect(result.error?.title).toBe('fetch_failed')
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('refuses a private/metadata address without touching the network (SSRF guard)', async () => {
    const result = await uploadHeaderMediaFromUrl('https://169.254.169.254/latest/meta-data/')

    expect(result.error?.title).toBe('fetch_failed')
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('refuses a host that is not the configured Supabase host', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')

    const result = await uploadHeaderMediaFromUrl('https://evil.example.com/x.jpg')

    expect(result.error?.title).toBe('fetch_failed')
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('returns fetch_failed when the source image cannot be read', async () => {
    fetchMock().mockResolvedValueOnce({ ok: false, status: 404 })

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result.error?.title).toBe('fetch_failed')
  })

  it('rejects an oversized image by its content-length before uploading', async () => {
    fetchMock().mockResolvedValueOnce(bytesResponse(6 * 1024 * 1024, 'image/png'))

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result.error?.title).toBe('fetch_failed')
    // Only the source fetch happened — no upload calls.
    expect(fetchMock()).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-image content type', async () => {
    fetchMock().mockResolvedValueOnce(bytesResponse(1024, 'text/html'))

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result.error?.title).toBe('fetch_failed')
    expect(fetchMock()).toHaveBeenCalledTimes(1)
  })

  it('creates a session (Bearer) then uploads the bytes (OAuth) and returns the handle', async () => {
    fetchMock()
      .mockResolvedValueOnce(bytesResponse(2048, 'image/png'))
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:SESSION123' }))
      .mockResolvedValueOnce(jsonResponse({ h: '4:handle:abc' }))

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result).toEqual({ ok: true, handle: '4:handle:abc' })

    // session creation: app-scoped /uploads with file metadata + Bearer auth
    const sessionCall = fetchMock().mock.calls[1]
    expect(sessionCall[0]).toContain('/v21.0/app-123/uploads')
    expect(sessionCall[0]).toContain('file_length=2048')
    expect(sessionCall[0]).toContain('file_type=image%2Fpng')
    expect(sessionCall[1].headers.Authorization).toBe('Bearer sys-token-xyz')

    // byte upload: OAuth auth, posts to the returned session id with file_offset 0
    const uploadCall = fetchMock().mock.calls[2]
    expect(uploadCall[0]).toContain('/v21.0/upload:SESSION123')
    expect(uploadCall[1].headers.Authorization).toBe('OAuth sys-token-xyz')
    expect(uploadCall[1].headers.file_offset).toBe('0')
  })

  it('strips MIME parameters from the fetched content type before session create', async () => {
    fetchMock()
      .mockResolvedValueOnce(bytesResponse(2048, 'image/jpeg; charset=binary'))
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:SESSION123' }))
      .mockResolvedValueOnce(jsonResponse({ h: '4:handle:abc' }))

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result.ok).toBe(true)
    expect(fetchMock().mock.calls[1][0]).toContain('file_type=image%2Fjpeg')
  })

  it('returns upload_failed with Metas parsed message when the session cannot be created', async () => {
    fetchMock()
      .mockResolvedValueOnce(bytesResponse(2048))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'bad app' } }, false))

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result.error?.title).toBe('upload_failed')
    expect(result.error?.details).toContain('bad app')
  })

  it('returns upload_failed when the upload response carries no handle', async () => {
    fetchMock()
      .mockResolvedValueOnce(bytesResponse(2048))
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:SESSION123' }))
      .mockResolvedValueOnce(jsonResponse({ nothing: true }))

    const result = await uploadHeaderMediaFromUrl(IMAGE_URL)

    expect(result.error?.title).toBe('upload_failed')
  })
})
