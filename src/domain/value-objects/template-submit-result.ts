/**
 * Outcome of submitting a template to Meta for approval. The `templateId` is
 * the Meta template id and is the only way we can correlate the local row in
 * `whatsapp_templates` with downstream status syncs.
 *
 * `ok=true` requires a non-null `templateId`. Adapters that legitimately skip
 * the network (e.g. no API key) return `ok=false` with `error.title` describing
 * the skip reason — a skip is NOT a rejection, and callers must keep the two
 * apart (a skip must never write `rejectionReason`).
 *
 * Error titles are machine-readable:
 * - `kapso_no_api_key`      — client not configured; nothing was submitted
 * - `meta_rejected`         — Meta refused the payload; `details` carries its reason
 * - `template_create_error` — any other failure; `details` carries the message
 */
export type TemplateSubmitErrorTitle =
  | 'kapso_no_api_key'
  | 'meta_rejected'
  | 'template_create_error'

export interface TemplateSubmitResult {
  ok: boolean
  templateId: string | null
  status: string | null
  error?: { title: TemplateSubmitErrorTitle; details?: string }
}
