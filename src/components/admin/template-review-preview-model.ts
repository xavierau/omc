// WAQ-011-DETAIL: turns stored template components into what the admin
// preview bubble renders. Media URLs are admitted only as https — anything
// else (a minted `4:` handle, http, javascript:) renders as "no preview".

import type {
  TemplateComponent,
  TemplateButtonType,
} from '@/domain/entities/whatsapp-template'
import { readHeaderHandle } from '@/domain/services/template-media-header'

export type PreviewHeader =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'video'; url: string }
  | { kind: 'document'; url: string | null }
  | { kind: 'media-unavailable' }

export interface PreviewButton {
  type: TemplateButtonType
  text: string
  /** URL or phone number the button opens; null for quick reply / copy code. */
  target: string | null
}

export interface TemplatePreviewModel {
  header: PreviewHeader | null
  body: string | null
  footer: string | null
  buttons: PreviewButton[]
}

export function safeHttpsUrl(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function buildTemplatePreview(components: TemplateComponent[]): TemplatePreviewModel {
  const find = (type: TemplateComponent['type']) => components.find((c) => c.type === type)
  return {
    header: toHeader(find('HEADER')),
    body: find('BODY')?.text ?? null,
    footer: find('FOOTER')?.text ?? null,
    buttons: (find('BUTTONS')?.buttons ?? []).map(toButton),
  }
}

function toHeader(c: TemplateComponent | undefined): PreviewHeader | null {
  if (!c) return null
  const format = c.format ?? 'TEXT'
  if (format === 'TEXT') return c.text ? { kind: 'text', text: c.text } : null
  const url = safeHttpsUrl(readHeaderHandle(c)?.[0])
  if (format === 'DOCUMENT') return { kind: 'document', url }
  if (!url) return { kind: 'media-unavailable' }
  return { kind: format === 'VIDEO' ? 'video' : 'image', url }
}

// Stored rows carry the phone under `phoneNumber` (entity) — `phone_number`
// is accepted too, mirroring the header-handle dual shape.
function toButton(b: NonNullable<TemplateComponent['buttons']>[number]): PreviewButton {
  const raw = b as typeof b & { phone_number?: string }
  const target =
    b.type === 'URL' ? b.url ?? null
    : b.type === 'PHONE_NUMBER' ? b.phoneNumber ?? raw.phone_number ?? null
    : null
  return { type: b.type, text: b.text, target }
}
