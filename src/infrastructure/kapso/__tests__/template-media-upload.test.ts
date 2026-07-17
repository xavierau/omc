import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { uploadHeaderMediaFromUrl } from '@/infrastructure/kapso/template-media-upload'

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body, text: async () => JSON.stringify(body) }
}

const PHONE = 'phone-123'
const IMAGE_URL = 'https://proj.supabase.co/storage/v1/object/public/wa-template-media/rest-1/header.png'

describe('uploadHeaderMediaFromUrl (Kapso Platform Media API)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('KAPSO_API_KEY', 'kapso-key-xyz')
    // No configured Supabase host → host allow-list is skipped (unit tests).
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('skips with not_configured when the Kapso key is missing (never calls Kapso)', async () => {
    vi.stubEnv('KAPSO_API_KEY', '')

    const result = await uploadHeaderMediaFromUrl(PHONE, IMAGE_URL)

    expect(result).toEqual({ ok: false, handle: null, error: { title: 'not_configured' } })
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('skips with not_configured when there is no phone number to bind the upload to', async () => {
    const result = await uploadHeaderMediaFromUrl('', IMAGE_URL)

    expect(result.error?.title).toBe('not_configured')
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('refuses a non-https source URL without calling Kapso', async () => {
    const result = await uploadHeaderMediaFromUrl(PHONE, 'http://proj.supabase.co/x.png')

    expect(result.error?.title).toBe('fetch_failed')
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('refuses a source URL whose host is not the configured Supabase host', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')

    const result = await uploadHeaderMediaFromUrl(PHONE, 'https://evil.example.com/x.png')

    expect(result.error?.title).toBe('fetch_failed')
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('ingests the URL through Kapso and returns the minted handle', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ data: { ingest_id: 'ing-1', target: { kind: 'meta_resumable_asset', handle: '4:aW1n' } } })
    )

    const result = await uploadHeaderMediaFromUrl(PHONE, IMAGE_URL)

    expect(result).toEqual({ ok: true, handle: '4:aW1n' })

    const [calledUrl, init] = fetchMock().mock.calls[0]
    expect(calledUrl).toBe('https://api.kapso.ai/platform/v1/whatsapp/media')
    expect(init.method).toBe('POST')
    expect(init.headers['X-API-Key']).toBe('kapso-key-xyz')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body)
    expect(body.media_ingest).toMatchObject({
      phone_number_id: PHONE,
      source: IMAGE_URL,
      delivery: 'meta_resumable_asset',
      mime_type: 'image/png',
    })
    expect(body.media_ingest.filename).toBe('header.png')
  })

  it('derives the mime type from the URL extension (webp)', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ data: { target: { handle: '4:aW1n' } } })
    )

    await uploadHeaderMediaFromUrl(PHONE, 'https://proj.supabase.co/storage/v1/object/public/wa-template-media/rest-1/h.webp')

    const body = JSON.parse(fetchMock().mock.calls[0][1].body)
    expect(body.media_ingest.mime_type).toBe('image/webp')
  })

  it('returns upload_failed when Kapso responds non-2xx', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ error: 'bad source' }, false))

    const result = await uploadHeaderMediaFromUrl(PHONE, IMAGE_URL)

    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('upload_failed')
  })

  it('returns upload_failed when the response carries no handle', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ data: { ingest_id: 'ing-1', target: {} } }))

    const result = await uploadHeaderMediaFromUrl(PHONE, IMAGE_URL)

    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('upload_failed')
  })
})
