import type { MediaHandleResult } from '@/domain/value-objects/media-handle-result'

/**
 * Mints a Meta template header handle from a hosted image URL via Kapso's
 * Platform Media API.
 *
 * Meta accepts a media template header only as a resumable-upload file handle
 * (`example.header_handle`, `4:...`), which the standard Cloud-API media upload
 * does not return. Kapso's Platform endpoint runs Meta's resumable-upload flow
 * server-side — under the app tied to the given phone number, so the handle is
 * created in the correct app context (no cross-app rejection) — and returns the
 * `h` handle. It fetches the image itself, so we hand it a URL, never bytes.
 *
 * Auth is the existing Kapso API key; when unset the call is a no-op SKIP
 * (`not_configured`) so the template simply stays a draft.
 */

const KAPSO_MEDIA_URL = 'https://api.kapso.ai/platform/v1/whatsapp/media'

function skip(): MediaHandleResult {
  return { ok: false, handle: null, error: { title: 'not_configured' } }
}

function failed(
  title: 'fetch_failed' | 'upload_failed',
  details: string
): MediaHandleResult {
  return { ok: false, handle: null, error: { title, details } }
}

export async function uploadHeaderMediaFromUrl(
  phoneNumberId: string,
  url: string
): Promise<MediaHandleResult> {
  const apiKey = process.env.KAPSO_API_KEY
  if (!apiKey || !phoneNumberId) return skip()

  const urlError = invalidSourceUrl(url)
  if (urlError) return failed('fetch_failed', urlError)

  try {
    const res = await fetch(KAPSO_MEDIA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        media_ingest: {
          phone_number_id: phoneNumberId,
          source: url,
          delivery: 'meta_resumable_asset',
          filename: filenameFromUrl(url),
          mime_type: mimeFromUrl(url),
        },
      }),
    })

    if (!res.ok) return failed('upload_failed', await describeFailure(res))

    const body = (await res.json()) as { data?: { target?: { handle?: string } } }
    const handle = body.data?.target?.handle
    if (!handle) return failed('upload_failed', 'Kapso returned no media handle')

    return { ok: true, handle }
  } catch (err) {
    return failed('upload_failed', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Returns a reason if the URL must not be forwarded to Kapso, else null. We only
 * ever ask Kapso to ingest our own public storage: https, no credentials, and
 * (when configured) the Supabase storage host — so a hostile URL cannot turn
 * Kapso's fetch into an SSRF probe.
 */
function invalidSourceUrl(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'header image URL is not a valid URL'
  }
  if (url.protocol !== 'https:') return 'header image URL must use https'
  if (url.username || url.password) return 'header image URL must not contain credentials'

  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (raw) {
    let supabaseHost: string | null = null
    try {
      supabaseHost = new URL(raw).host
    } catch {
      supabaseHost = null
    }
    if (supabaseHost && url.host !== supabaseHost) return 'header image URL host is not allowed'
  }
  return null
}

function filenameFromUrl(rawUrl: string): string {
  try {
    const name = new URL(rawUrl).pathname.split('/').pop()
    return name && name.length > 0 ? name : 'header'
  } catch {
    return 'header'
  }
}

function mimeFromUrl(rawUrl: string): string {
  return /\.png($|\?)/i.test(rawUrl) ? 'image/png' : 'image/jpeg'
}

async function describeFailure(res: {
  status: number
  text: () => Promise<string>
}): Promise<string> {
  const text = await res.text().catch(() => '')
  return `Kapso media ingest failed (${res.status})${text ? `: ${text}` : ''}`
}
