/**
 * REPLY-005: pure parser for a WhatsApp Flow contact-form submission.
 *
 * `flowResponse` is the raw, JSON-parsed `nfm_reply.response_json` object
 * from the webhook (`webhook-parser.ts`'s `KapsoMessage.flowResponse`).
 * Zero infra imports — the webhook handler owns logging/dispatch on the
 * result.
 */

import type { ContactFormSubmission } from './contact-email'

export type ParsedContactFormSubmission =
  | { ok: true; submission: ContactFormSubmission }
  | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The Flow's Footer `onClickAction.payload` field names,
 * `src/infrastructure/whatsapp/flows/contact-form-flow.json`. NOTE:
 * camelCase, not the plan's originally-proposed snake_case — the Kapso SDK's
 * `flows.deploy`/`create` forces strict-camelCase Flow JSON authoring
 * (`toFlowJsonWireCase`, verified against `dist/index.js` by Stream B2,
 * `artifacts/2026-07-26-reply-005-flow-deploy-backend.md` finding #5), so a
 * real submission's `nfm_reply.response_json` carries camelCase keys.
 *
 * Exported so the Flow JSON <-> parser contract test
 * (`contact-form-flow.contract.test.ts`) asserts against this constant
 * rather than a re-typed literal — it must fail if either side renames a key.
 */
export const CONTACT_FORM_SUBMISSION_KEYS = ['clientName', 'clientWhatsapp', 'topic'] as const

/**
 * Requires every key in `CONTACT_FORM_SUBMISSION_KEYS` as a non-empty string.
 * Driven by the constant (not re-typed field-by-field) so the two can never
 * silently drift. Anything else — wrong shape, missing/blank/non-string
 * fields — is `ok:false`.
 */
export function parseContactFormSubmission(flowResponse: unknown): ParsedContactFormSubmission {
  if (!isRecord(flowResponse)) {
    return { ok: false, reason: 'flow_response_not_an_object' }
  }

  const values = {} as Record<(typeof CONTACT_FORM_SUBMISSION_KEYS)[number], string>
  for (const key of CONTACT_FORM_SUBMISSION_KEYS) {
    const value = requireNonEmptyString(flowResponse[key])
    if (!value) return { ok: false, reason: 'missing_or_invalid_fields' }
    values[key] = value
  }

  return { ok: true, submission: values }
}
