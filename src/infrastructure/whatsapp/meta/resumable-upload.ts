import type { MediaHandleResult } from '@/domain/value-objects/media-handle-result'

/**
 * Mints a Meta template header handle from an already-hosted image URL.
 *
 * Meta accepts media template headers only as a resumable-upload file handle
 * (`example.header_handle`, `4:...`), never a plain URL or media id. That handle
 * comes only from Meta's App-level Resumable Upload API, which the Kapso proxy
 * does not expose — so this talks to graph.facebook.com directly with our own
 * Meta app credentials. Two calls:
 *   1. POST /{app_id}/uploads  (Bearer auth) → create a session, returns { id }
 *   2. POST /{session_id}      (OAuth auth)  → send the bytes, returns { h }
 *
 * The two calls use different auth header schemes — that is Meta's documented
 * contract for resumable upload, not a mistake.
 *
 * Credentials are read from the environment; when unset the call is a no-op
 * SKIP (`meta_not_configured`) so a deployment without Meta app access behaves
 * exactly as before — media headers stay blocked, nothing throws.
 *
 * The source URL is attacker-influenceable (it arrives in template components on
 * the dashboard API), so the fetch is hardened against SSRF and memory
 * exhaustion before any byte is read — see fetchableImageUrlError / readCapped.
 */

const GRAPH_BASE_URL = 'https://graph.facebook.com'
const DEFAULT_GRAPH_VERSION = 'v21.0'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

function skip(): MediaHandleResult {
  return { ok: false, handle: null, error: { title: 'meta_not_configured' } }
}

function failed(
  title: 'fetch_failed' | 'upload_failed',
  details: string
): MediaHandleResult {
  return { ok: false, handle: null, error: { title, details } }
}

export async function uploadHeaderMediaFromUrl(
  url: string
): Promise<MediaHandleResult> {
  const appId = process.env.META_APP_ID
  const token = process.env.META_ACCESS_TOKEN
  if (!appId || !token) return skip()

  const urlError = fetchableImageUrlError(url)
  if (urlError) return failed('fetch_failed', urlError)

  const version = process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION

  let bytes: ArrayBuffer
  let contentType: string
  try {
    const res = await fetch(url, { redirect: 'error' })
    if (!res.ok) return failed('fetch_failed', `Image URL returned ${res.status}`)

    contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return failed('fetch_failed', `Unsupported image type: ${contentType || 'unknown'}`)
    }

    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      return failed('fetch_failed', 'Image exceeds the 5MB limit')
    }

    bytes = await readCapped(res, MAX_IMAGE_BYTES)
  } catch (err) {
    return failed('fetch_failed', err instanceof Error ? err.message : String(err))
  }

  try {
    const sessionId = await createUploadSession(version, appId, token, bytes.byteLength, contentType)
    if (!sessionId) return failed('upload_failed', 'Meta did not return an upload session id')

    const handle = await uploadBytes(version, sessionId, token, bytes)
    if (!handle) return failed('upload_failed', 'Meta did not return a file handle')

    return { ok: true, handle }
  } catch (err) {
    return failed('upload_failed', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Returns a reason string if the URL must not be fetched, or null if it is safe.
 * Fails closed: https only, no embedded credentials, and either an exact match
 * of the configured Supabase storage host (the normal case in any real
 * deployment) or — when that host is unconfigured — a rejection of private,
 * loopback, link-local and metadata addresses. Redirects are refused at fetch
 * time (`redirect: 'error'`) so a public URL cannot bounce to an internal one.
 */
function fetchableImageUrlError(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'header image URL is not a valid URL'
  }
  if (url.protocol !== 'https:') return 'header image URL must use https'
  if (url.username || url.password) return 'header image URL must not contain credentials'

  const supabaseHost = supabaseStorageHost()
  if (supabaseHost) {
    if (url.host !== supabaseHost) return 'header image URL host is not allowed'
  } else if (isPrivateHost(url.hostname)) {
    return 'header image URL resolves to a private address'
  }
  return null
}

function supabaseStorageHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  try {
    return new URL(raw).host
  } catch {
    return null
  }
}

function isPrivateHost(hostname: string): boolean {
  // Strip brackets and a trailing FQDN dot so `127.0.0.1.` / `localhost.` cannot
  // slip past the literal checks below.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true

  // IPv4-mapped IPv6 — evaluate the embedded IPv4 so a mapped metadata address
  // cannot slip past the v4 checks. WHATWG serialises these in hex
  // (::ffff:a9fe:a9fe), but accept the dotted form too for robustness.
  const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mappedDotted) return isPrivateHost(mappedDotted[1])
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16)
    const lo = parseInt(mappedHex[2], 16)
    return isPrivateHost(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`)
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = v4.slice(1).map(Number)
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }

  // IPv6 loopback / link-local / unique-local literals.
  if (host === '::1') return true
  return host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')
}

/** Reads the body but aborts once it exceeds `max`, so a lying/huge source cannot OOM us. */
async function readCapped(
  res: { body?: ReadableStream<Uint8Array> | null; arrayBuffer: () => Promise<ArrayBuffer> },
  max: number
): Promise<ArrayBuffer> {
  const reader = res.body?.getReader?.()
  if (!reader) {
    const buf = await res.arrayBuffer()
    if (buf.byteLength > max) throw new Error('Image exceeds the 5MB limit')
    return buf
  }

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      throw new Error('Image exceeds the 5MB limit')
    }
    chunks.push(value)
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out.buffer
}

async function createUploadSession(
  version: string,
  appId: string,
  token: string,
  fileLength: number,
  fileType: string
): Promise<string | null> {
  const query = new URLSearchParams({
    file_name: 'header',
    file_length: String(fileLength),
    file_type: fileType,
  })
  const res = await fetch(`${GRAPH_BASE_URL}/${version}/${appId}/uploads?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
  })
  if (!res.ok) throw new Error(await describeGraphFailure(res))
  const body = (await res.json()) as { id?: string }
  return body.id ?? null
}

async function uploadBytes(
  version: string,
  sessionId: string,
  token: string,
  bytes: ArrayBuffer
): Promise<string | null> {
  const res = await fetch(`${GRAPH_BASE_URL}/${version}/${sessionId}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
    body: bytes,
    redirect: 'error',
  })
  if (!res.ok) throw new Error(await describeGraphFailure(res))
  const body = (await res.json()) as { h?: string }
  return body.h ?? null
}

/** Extracts Meta's own error message when present, rather than echoing the raw body. */
async function describeGraphFailure(res: {
  status: number
  text: () => Promise<string>
}): Promise<string> {
  const text = await res.text().catch(() => '')
  let message = ''
  try {
    message = (JSON.parse(text) as { error?: { message?: string } })?.error?.message ?? ''
  } catch {
    message = ''
  }
  return `Meta upload failed (${res.status})${message ? `: ${message}` : ''}`
}
