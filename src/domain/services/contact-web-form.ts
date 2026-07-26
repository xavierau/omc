/**
 * REPLY-008: pure domain rules for the web contact form.
 *
 * The web form is the fallback rung used while WhatsApp Flows cannot be
 * published (issue #78). Zero infra imports — the route/handler layers own
 * persistence, sending, and logging.
 */

import type { ContactFormSubmission } from './contact-email'
import { CONTACT_FORM_SUBMISSION_KEYS } from './contact-form-submission'

/**
 * How long an issued link stays usable.
 *
 * Deliberately far shorter than it needs to be for the customer's sake,
 * because it is what makes the acknowledgement deliverable: WhatsApp's
 * 24-hour service window runs from the customer's last inbound message, and
 * the link is issued in direct reply to one. Submitting inside 30 minutes
 * therefore guarantees the ack send is still inside that window, whereas a
 * link left open overnight would produce a submission we can accept but never
 * confirm ("Cannot send non-template messages outside the 24-hour window").
 *
 * The cost of being wrong is one tap: an expired link offers a deep link that
 * re-triggers CONTACT and mints a fresh one.
 */
export const CONTACT_FORM_TOKEN_TTL_MS = 30 * 60 * 1000

/** Why a token cannot be used — each maps to a distinct page state. */
export type ContactTokenState = 'valid' | 'expired' | 'consumed' | 'unknown'

export const CLIENT_NAME_MAX_LEN = 60

/**
 * Parse a web form POST body into the SAME domain type the Flow path
 * produces, so notification/email formatting stays single-sourced.
 *
 * `clientWhatsapp` is NOT taken from the body: it is derived server-side from
 * the token, which is the only authenticated fact about a public web
 * submission. A body value for it is accepted and ignored rather than
 * rejected, so a stale or tampered field can never change who the enquiry
 * appears to come from.
 */
export type ParsedWebFormSubmission =
  | { ok: true; submission: ContactFormSubmission }
  | { ok: false; reason: string }

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function parseWebFormSubmission(
  body: unknown,
  tokenPhone: string,
  allowedTopics: string[]
): ParsedWebFormSubmission {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, reason: 'body_not_object' }
  }
  const record = body as Record<string, unknown>

  const clientName = cleanString(record.clientName)
  if (!clientName) return { ok: false, reason: 'missing_clientName' }
  if (clientName.length > CLIENT_NAME_MAX_LEN) {
    return { ok: false, reason: 'clientName_too_long' }
  }

  const topic = cleanString(record.topic)
  if (!topic) return { ok: false, reason: 'missing_topic' }
  // Closed set, not free text: the topic reaches the restaurant's inbox, and
  // the Flow's Dropdown offers exactly these. Accepting arbitrary strings here
  // would make the web form a strictly weaker contract than the Flow it
  // stands in for, and an email-injection surface.
  if (!allowedTopics.includes(topic)) {
    return { ok: false, reason: 'topic_not_allowed' }
  }

  return { ok: true, submission: { clientName, clientWhatsapp: tokenPhone, topic } }
}

/**
 * Keys the web form posts. Exported so the page, the parser, and their tests
 * agree by construction — the same reason `CONTACT_FORM_SUBMISSION_KEYS`
 * exists for the Flow JSON contract. `clientWhatsapp` is intentionally absent:
 * it is never posted.
 */
export const WEB_FORM_POST_KEYS = CONTACT_FORM_SUBMISSION_KEYS.filter(
  (key) => key !== 'clientWhatsapp'
)

/**
 * Build the public URL for an issued token.
 *
 * The token rides in the query string because it must survive being handed to
 * WhatsApp as a CTA URL; it is a one-off, 30-minute capability rather than a
 * long-lived secret, and the phone number it authorises is not in the URL.
 */
export function buildContactFormUrl(appUrl: string, slug: string, token: string): string | null {
  const base = appUrl.replace(/\/+$/, '')
  if (!base || !slug || !token) return null
  return `${base}/contact/${encodeURIComponent(slug)}?t=${encodeURIComponent(token)}`
}
