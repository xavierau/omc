// REPLY-005: Resend adapter for EmailPort. Plain `fetch` POST — no SDK
// dependency; the port makes swapping in the official `resend` package (or
// another provider) a contained change later.
//
// Posture mirrors `src/infrastructure/kapso/client.ts`: missing config or a
// send failure never throws, it degrades to a Result with `ok:false`.

import type { EmailPort } from '@/domain/ports/email'
import type { EmailSendResult } from '@/domain/value-objects/email-send-result'

const RESEND_API_URL = 'https://api.resend.com/emails'

// Bounds how long a stalled Resend request can hold the caller open. This
// sits on the post-idempotency-claim hot path (see file header on the
// caller side) — nothing here may block indefinitely.
const RESEND_TIMEOUT_MS = 10_000

// Bounds and sanitises the provider error body kept in `error.details`.
// `contact-form-handler.ts` logs that field at 'error' level — if Resend
// ever reflects request content (e.g. the recipient address) back in a 4xx
// body, an unbounded/raw copy would persist that PII into application logs.
const MAX_ERROR_BODY_LEN = 200
const EMAIL_IN_BODY_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g

type EmailMessage = { to: string; subject: string; text: string; html?: string }
type ResendConfig = { apiKey: string; from: string }

function resolveConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) return null
  return { apiKey, from }
}

function skipResult(title: string): EmailSendResult {
  return { ok: false, providerMessageId: null, raw: null, error: { title } }
}

function errorResult(title: string, err: unknown): EmailSendResult {
  const details = err instanceof Error ? err.message : String(err)
  return { ok: false, providerMessageId: null, raw: null, error: { title, details } }
}

// Resend's API lists `html` among the required body fields (`text` is the
// optional counterpart it derives a plain-text alternative from). To avoid a
// text-only send risking rejection or degraded deliverability, derive a
// minimal HTML alternative from `text` whenever the caller doesn't supply
// one. `text` may carry attacker-influenced content (a WhatsApp user's
// `client_name`/`topic`), so it is HTML-escaped before interpolation.
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function deriveHtmlFromText(text: string): string {
  const style =
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; white-space: pre-wrap; font-size: 14px;"
  return `<pre style="${style}">${escapeHtml(text)}</pre>`
}

function buildResendPayload(from: string, message: EmailMessage): Record<string, unknown> {
  return {
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html ?? deriveHtmlFromText(message.text),
  }
}

function postToResend(config: ResendConfig, message: EmailMessage): Promise<Response> {
  return fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildResendPayload(config.from, message)),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
  })
}

/** `AbortSignal.timeout(...)` rejects `fetch` with a `TimeoutError` DOMException. */
function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError'
}

function sanitizeErrorBody(body: string): string {
  const redacted = body.replace(EMAIL_IN_BODY_RE, '[redacted-email]')
  return redacted.length > MAX_ERROR_BODY_LEN
    ? `${redacted.slice(0, MAX_ERROR_BODY_LEN)}…`
    : redacted
}

async function safeReadText(response: Response): Promise<string | undefined> {
  try {
    return await response.text()
  } catch {
    return undefined
  }
}

async function nonOkResult(response: Response): Promise<EmailSendResult> {
  const body = await safeReadText(response)
  const summary = body ? sanitizeErrorBody(body) : ''
  return {
    ok: false,
    providerMessageId: null,
    raw: null,
    error: {
      title: 'resend_non_2xx',
      details: `HTTP ${response.status}: ${summary}`.trim(),
    },
  }
}

async function okResult(response: Response): Promise<EmailSendResult> {
  let raw: Record<string, unknown> | null = null
  try {
    raw = (await response.json()) as Record<string, unknown>
  } catch {
    raw = null
  }
  const id = raw && typeof raw.id === 'string' ? raw.id : null
  if (!id) {
    return { ok: false, providerMessageId: null, raw, error: { title: 'resend_no_message_id' } }
  }
  return { ok: true, providerMessageId: id, raw }
}

async function sendViaResend(message: EmailMessage): Promise<EmailSendResult> {
  const config = resolveConfig()
  if (!config) {
    console.warn('[Resend] Not configured — email not sent')
    return skipResult('resend_not_configured')
  }
  try {
    const response = await postToResend(config, message)
    return response.ok ? await okResult(response) : await nonOkResult(response)
  } catch (err) {
    if (isTimeoutError(err)) {
      console.warn(`[Resend] Request timed out after ${RESEND_TIMEOUT_MS}ms`)
      return errorResult('resend_timeout', err)
    }
    console.warn('[Resend] Error sending email:', err instanceof Error ? err.message : String(err))
    return errorResult('resend_send_error', err)
  }
}

export const resendEmailAdapter: EmailPort = {
  send: sendViaResend,
}
