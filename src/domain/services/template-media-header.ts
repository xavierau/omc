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
 * Send-time header source (#127 / CAMP-007): the stored handle only usable at
 * send time when it is a public http(s) URL — stored rows keep the URL by
 * design (see resolve-header-media.ts), while a minted `4:` upload handle is
 * a template-creation artifact Meta will not accept in a message send.
 */
export function readHeaderLink(c: TemplateComponent): string | null {
  const source = readHeaderHandle(c)?.[0]
  if (!source || !/^https?:\/\//i.test(source)) return null
  return source
}

/**
 * Reads the handle from either key shape found in real rows (see the `example`
 * doc on the entity). An empty list counts as absent.
 */
export function readHeaderHandle(c: TemplateComponent): string[] | undefined {
  // Checked by length rather than `??`/`||`: an empty array is neither nullish nor
  // falsy, so either operator would stop at an empty camelCase key and miss a
  // populated snake-case one.
  const camel = c.example?.headerHandle
  if (camel?.length) return camel

  const snake = c.example?.header_handle
  return snake?.length ? snake : undefined
}
