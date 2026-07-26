import type { TemplateComponent } from '@/domain/entities/whatsapp-template'
import { isMediaHeader, readHeaderHandle } from './template-media-header'

/**
 * Save-time gate for components Meta is certain to reject.
 *
 * Returns a user-facing message, or null when the components are submittable.
 */

/** Meta accepts media headers only as resumable-upload handles, which start with '4:'. */
const RESUMABLE_HANDLE_PREFIX = '4:'

// Reached only after the submit paths mint a handle from the uploaded image, so
// hitting this means the media header carries no usable image (empty, or a value
// that is neither an uploaded handle nor a fetchable URL) — not that media
// headers are unsupported.
const MEDIA_HANDLE_REQUIRED =
  'This image, video or document header has no valid uploaded media. ' +
  'Please re-upload the header file and try again.'

export function validateTemplateComponents(
  components: TemplateComponent[]
): string | null {
  for (const c of components) {
    if (!isMediaHeader(c)) continue
    const handle = readHeaderHandle(c)
    if (!handle?.[0]?.startsWith(RESUMABLE_HANDLE_PREFIX)) return MEDIA_HANDLE_REQUIRED
  }

  return null
}
