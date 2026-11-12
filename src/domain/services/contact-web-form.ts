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
export const CLIENT_PHONE_MAX_LEN = 30

/**
 * Parse a web form POST body into the SAME domain type the Flow path
 * produces, so notification/email formatting stays single-sourced.
 *
 * `clientWhatsapp` IS taken from the body, matching the Flow's editable phone
 * TextInput. The number a customer wants to be called back on is not
 * necessarily the one they happen to be messaging from — a shared phone, a
 * work line, a relative's handset — and `buildContactEmail` already exists to
 * flag the difference (⚠️ 填寫號碼與傳送號碼不同). An earlier cut derived this
 * field from the token instead, which forced the two equal and made that
 * mismatch marker unreachable dead code. The web form asks for it outright
 * (no prefill), so the answer is a deliberate one rather than an unread
 * default echoing the sending handset.
 *
 * This costs nothing in trust: the AUTHENTICATED sender still comes from the
 * token and is reported separately as `senderWaId`. The typed value is
 * declared contact information, exactly as it is on the Flow — never an
 * identity claim.
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

  // The form starts this field empty and marks it required, so a missing
  // value means a client that bypassed the form rather than a customer who
  // skipped it. Falling back to the authenticated sender still beats
  // rejecting a real enquiry, and it can only ever resolve to the number we
  // already know — never to something a caller supplied. Bounded because it
  // reaches an inbox.
  const clientWhatsapp = cleanString(record.clientWhatsapp) ?? tokenPhone
  if (clientWhatsapp.length > CLIENT_PHONE_MAX_LEN) {
    return { ok: false, reason: 'clientWhatsapp_too_long' }
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

  return { ok: true, submission: { clientName, clientWhatsapp, topic } }
}

/**
 * Keys the web form posts — the same three the Flow's Footer payload carries,
 * so the two channels stay in lockstep. Exported so the page, the parser, and
 * their tests agree by construction, the same reason
 * `CONTACT_FORM_SUBMISSION_KEYS` exists for the Flow JSON contract.
 */
export const WEB_FORM_POST_KEYS = CONTACT_FORM_SUBMISSION_KEYS

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
