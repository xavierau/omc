import type { TemplateComponent } from '@/domain/entities/whatsapp-template'

/**
 * Shared reading of media header handles, so that the submit path
 * (prepare-template-components) and the save-time gate
 * (validate-template-components) can never disagree about what a handle is.
 */

/** Header formats that carry an uploaded asset instead of text. */
const MEDIA_HEADER_FORMATS: readonly string[] = ['IMAGE', 'VIDEO', 'DOCUMENT']

export function isMediaHeader(c: TemplateComponent): boolean {
  return c.type === 'HEADER' && MEDIA_HEADER_FORMATS.includes(c.format ?? '')
}

/**
 * Reads the handle from either key shape found in real rows (see the `example`
 * doc on the entity). An empty list counts as absent.
 */
export function readHeaderHandle(c: TemplateComponent): string[] | undefined {
  const handle = c.example?.headerHandle ?? c.example?.header_handle
  return handle?.length ? handle : undefined
}
