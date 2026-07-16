import type { TemplateComponent } from '@/domain/entities/whatsapp-template'
import { isMediaHeader, readHeaderHandle } from '@/domain/services/template-media-header'
import { uploadHeaderMediaFromUrl } from '@/infrastructure/whatsapp/meta/resumable-upload'
import type { MediaHandleErrorTitle } from '@/domain/value-objects/media-handle-result'

/**
 * Turns dashboard-authored image headers (which carry a hosted image URL) into
 * the Meta resumable-upload handles a template submission requires.
 *
 * Runs at submit time only, against a COPY of the components — stored rows keep
 * the URL, because a handle expires in ~24h and would otherwise become the only
 * (dead) reference to the image. A component that already holds a handle, or a
 * non-media header, passes straight through, so a text-only template never
 * touches Meta and never needs Meta app credentials.
 *
 * The first failed upload short-circuits: a media template must not be
 * submitted with some headers minted and others still URLs.
 */

type MediaHandleError = { title: MediaHandleErrorTitle; details?: string }

export type ResolveHeaderMediaResult =
  | { ok: true; components: TemplateComponent[] }
  | { ok: false; error: MediaHandleError }

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

export async function resolveHeaderMedia(
  components: TemplateComponent[]
): Promise<ResolveHeaderMediaResult> {
  const resolved: TemplateComponent[] = []

  for (const c of components) {
    const minted = await mintHeaderIfNeeded(c)
    if (!minted.ok) return minted
    resolved.push(minted.component)
  }

  return { ok: true, components: resolved }
}

async function mintHeaderIfNeeded(
  c: TemplateComponent
): Promise<{ ok: true; component: TemplateComponent } | { ok: false; error: MediaHandleError }> {
  if (!isMediaHeader(c)) return { ok: true, component: c }

  const source = readHeaderHandle(c)?.[0]
  // Nothing to mint (empty, or already a "4:" handle). Downstream validation
  // decides whether an unmintable value is submittable.
  if (!source || !isHttpUrl(source)) return { ok: true, component: c }

  const upload = await uploadHeaderMediaFromUrl(source)
  if (!upload.ok || !upload.handle) {
    return { ok: false, error: upload.error ?? { title: 'upload_failed' } }
  }

  // Write the minted handle as the ONLY handle. Dropping the camelCase key
  // matters: a source row may carry the URL under `headerHandle`, and
  // readHeaderHandle reads that key first — leaving it would resubmit the URL.
  const example = { ...c.example, header_handle: [upload.handle] }
  delete example.headerHandle
  return { ok: true, component: { ...c, example } }
}

/**
 * Maps a media-upload failure to the API's provider error contract. Shared by
 * every submit path (create / update / resubmit) so they can never drift.
 * `meta_not_configured` is a skip (no credentials), not a content failure.
 */
export function mapMediaHandleError(error: MediaHandleError): {
  message: string
  errorCode: 'provider_not_configured' | 'provider_error'
} {
  if (error.title === 'meta_not_configured') {
    return { message: 'Image upload is not configured', errorCode: 'provider_not_configured' }
  }
  return {
    message: error.details ?? 'Could not upload the header image to Meta',
    errorCode: 'provider_error',
  }
}
