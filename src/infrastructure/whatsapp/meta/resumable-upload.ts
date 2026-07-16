import type { MediaHandleResult } from '@/domain/value-objects/media-handle-result'

/**
 * Mints a Meta template header handle from an already-hosted image URL.
 *
 * Meta accepts media template headers only as a resumable-upload file handle
 * (`example.header_handle`), never a plain URL or media id. That handle comes
 * only from Meta's App-level Resumable Upload API, which the Kapso proxy does
 * not expose — so this talks to graph.facebook.com directly with our own Meta
 * app credentials. Two calls:
 *   1. POST /{app_id}/uploads  → create a session, returns { id }
 *   2. POST /{session_id}      → send the bytes, returns { h } (the handle)
 *
 * Credentials are read from the environment; when unset the call is a no-op
 * SKIP (`meta_not_configured`) so a deployment without Meta app access behaves
 * exactly as before — media headers stay blocked, nothing throws.
 */

const GRAPH_BASE_URL = 'https://graph.facebook.com'
const DEFAULT_GRAPH_VERSION = 'v21.0'

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

  const version = process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION
  const auth = { Authorization: `OAuth ${token}` }

  let bytes: ArrayBuffer
  let contentType: string
  try {
    const res = await fetch(url)
    if (!res.ok) return failed('fetch_failed', `Image URL returned ${res.status}`)
    contentType = res.headers.get('content-type') || 'image/jpeg'
    bytes = await res.arrayBuffer()
  } catch (err) {
    return failed('fetch_failed', err instanceof Error ? err.message : String(err))
  }

  try {
    const sessionId = await createUploadSession(version, appId, auth, bytes.byteLength, contentType)
    if (!sessionId) return failed('upload_failed', 'Meta did not return an upload session id')

    const handle = await uploadBytes(version, sessionId, auth, bytes)
    if (!handle) return failed('upload_failed', 'Meta did not return a file handle')

    return { ok: true, handle }
  } catch (err) {
    return failed('upload_failed', err instanceof Error ? err.message : String(err))
  }
}

async function createUploadSession(
  version: string,
  appId: string,
  auth: Record<string, string>,
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
    headers: auth,
  })
  if (!res.ok) throw new Error(await describeGraphFailure(res))
  const body = (await res.json()) as { id?: string }
  return body.id ?? null
}

async function uploadBytes(
  version: string,
  sessionId: string,
  auth: Record<string, string>,
  bytes: ArrayBuffer
): Promise<string | null> {
  const res = await fetch(`${GRAPH_BASE_URL}/${version}/${sessionId}`, {
    method: 'POST',
    headers: { ...auth, file_offset: '0' },
    body: bytes,
  })
  if (!res.ok) throw new Error(await describeGraphFailure(res))
  const body = (await res.json()) as { h?: string }
  return body.h ?? null
}

async function describeGraphFailure(res: { status: number; text: () => Promise<string> }): Promise<string> {
  const text = await res.text().catch(() => '')
  return `Meta upload failed (${res.status})${text ? `: ${text}` : ''}`
}
