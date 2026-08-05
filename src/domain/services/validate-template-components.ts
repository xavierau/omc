import type { TemplateButton, TemplateComponent } from '@/domain/entities/whatsapp-template'
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
    if (c.type === 'BUTTONS') {
      const buttonError = validateButtons(c.buttons ?? [])
      if (buttonError) return buttonError
      continue
    }
    if (!isMediaHeader(c)) continue
    const handle = readHeaderHandle(c)
    if (!handle?.[0]?.startsWith(RESUMABLE_HANDLE_PREFIX)) return MEDIA_HANDLE_REQUIRED
  }

  return null
}

/**
 * Meta refuses a URL or phone button whose own field is missing (code 100 /
 * subcode 2388050) and names it only as "Button at index N". Other button
 * types carry no such field, so they pass through untouched.
 */
function validateButtons(buttons: TemplateButton[]): string | null {
  for (const [i, b] of buttons.entries()) {
    if (b.type !== 'URL' && b.type !== 'PHONE_NUMBER') continue
    const name = `Button ${i + 1}`
    if (!b.text?.trim()) return `${name} has no label. Add the text shown on the button and try again.`
    if (b.type === 'URL' && !b.url?.trim()) {
      return `${name} is a link button with no URL. Add the link and try again.`
    }
    if (b.type === 'PHONE_NUMBER' && !b.phoneNumber?.trim()) {
      return `${name} is a phone button with no phone number. Add the number, including its country code, and try again.`
    }
  }

  return null
}
