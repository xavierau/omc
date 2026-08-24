import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import {
  isMediaHeader,
  readHeaderLink,
} from '@/domain/services/template-media-header'

// #127 / CAMP-007: a template that declares an IMAGE/VIDEO/DOCUMENT header
// must go out with a header parameter carrying a public media URL, or Meta
// rejects every send with #132012. When the stored row has no usable URL
// (only an expired `4:` upload handle, or nothing), the run is guaranteed to
// fail — so refuse to start it, with a reason the tenant can act on.
//
// Tenant-meaningful (campaign-queue.ts allowlist + the execute route's 409):
// safe to store in failure_reason and show verbatim.
export class TemplateHeaderMediaMissingError extends Error {
  constructor(templateName: string) {
    super(
      `WhatsApp template ${templateName} declares a media header but has no ` +
        'usable public media URL stored — edit the template and resubmit it ' +
        'with a hosted header image before sending'
    )
    this.name = 'TemplateHeaderMediaMissingError'
  }
}

export function enforceHeaderMedia(template: WhatsAppTemplate | null): void {
  if (!template) return
  const header = template.components.find(isMediaHeader)
  if (!header) return
  if (readHeaderLink(header) === null) {
    throw new TemplateHeaderMediaMissingError(template.name)
  }
}
