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

export type ResolveHeaderMediaResult =
  | { ok: true; components: TemplateComponent[] }
  | { ok: false; error: { title: MediaHandleErrorTitle; details?: string } }

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

export async function resolveHeaderMedia(
  components: TemplateComponent[]
): Promise<ResolveHeaderMediaResult> {
  const resolved: TemplateComponent[] = []

  for (const c of components) {
    if (!isMediaHeader(c)) {
      resolved.push(c)
      continue
    }

    const source = readHeaderHandle(c)?.[0]
    if (!source || !isHttpUrl(source)) {
      // Nothing to mint (empty, or already a "4:" handle). Downstream validation
      // decides whether an unmintable value is submittable.
      resolved.push(c)
      continue
    }

    const upload = await uploadHeaderMediaFromUrl(source)
    if (!upload.ok || !upload.handle) {
      return { ok: false, error: upload.error ?? { title: 'upload_failed' } }
    }

    // Write the minted handle as the ONLY handle. Dropping the camelCase key
    // matters: a source row may carry the URL under `headerHandle`, and
    // readHeaderHandle reads that key first — leaving it would resubmit the URL.
    const example = { ...c.example, header_handle: [upload.handle] }
    delete example.headerHandle
    resolved.push({ ...c, example })
  }

  return { ok: true, components: resolved }
}
