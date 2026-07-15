import type { TemplateComponent } from '@/domain/entities/whatsapp-template'
import { isMediaHeader, readHeaderHandle } from './template-media-header'

/**
 * Save-time gate for components Meta is certain to reject.
 *
 * Returns a user-facing message, or null when the components are submittable.
 */

/** Meta accepts media headers only as resumable-upload handles, which start with '4:'. */
const RESUMABLE_HANDLE_PREFIX = '4:'

const MEDIA_HANDLE_REQUIRED =
  'Image, video and document headers must use a Meta resumable-upload handle ' +
  '(a value starting with "4:"), not an image URL — Meta rejects the template ' +
  'otherwise. Uploading media headers from the dashboard is not supported yet, ' +
  'so please use a text header instead.'

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
