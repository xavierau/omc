// ISSUE-77: `email-send` queue job-processing logic, split out of
// email-queue.ts (BullMQ plumbing) per SRP.
//
// `resendEmailAdapter.send()` degrades to `{ ok: false, error }` by design
// (never throws — see resend-adapter.ts header) and BullMQ only retries on a
// thrown error, so this module's whole job is translating that Result into
// either: nothing (success), a thrown UnrecoverableError (permanent 4xx-class
// failure — bad recipient, unverified domain, revoked key — retrying is
// guaranteed to repeat it, so it goes straight to dead-letter instead of
// burning the configured attempts), or a thrown plain Error (transient
// 5xx/network — worth the retry/backoff).
import { UnrecoverableError } from 'bullmq'
import { getEmailProvider } from '@/infrastructure/email/provider-factory'
import { getContactConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { buildContactEmail } from '@/domain/services/contact-email'
import { notifyOpsAlert } from '@/application/notify-ops-alert'
import type { EmailSendResult } from '@/domain/value-objects/email-send-result'
import type { EmailJobData } from './email-queue'

// 429 is rate-limiting, not a malformed/rejected request — retrying with
// backoff is the correct response, so it's excluded from the permanent bucket.
const RETRYABLE_4XX_STATUSES: ReadonlySet<number> = new Set([429])
const HTTP_STATUS_RE = /^HTTP (\d{3}):/

export async function processEmailJob(data: EmailJobData): Promise<void> {
  const result = await sendEmail(data)
  if (result.ok) return

  const error = result.error ?? { title: 'unknown' }
  if (isPermanentFailure(result)) {
    await alertDeadLetter(data, error)
    throw new UnrecoverableError(`email permanently failed (${error.title}): ${data.messageId}`)
  }

  throw new Error(`email send failed, will retry (${error.title}): ${data.messageId}`)
}

/** `submittedAt` was captured at enqueue time — never re-derive "now" here,
 * or a retried job reports when it was processed instead of when the
 * customer actually submitted the form.
 *
 * `notificationEmail` is likewise taken from the job payload, not re-read
 * from live config on each attempt (PR #106 review question) — kept
 * point-in-time deliberately: a retry re-reading config could otherwise land
 * a resend at an address the tenant switched to for unrelated reasons, with
 * no context tying it back to this submission. `labels` IS re-read (below),
 * since tenant copy has no "as of submission" meaning the way a recipient
 * address does. */
async function sendEmail(data: EmailJobData): Promise<EmailSendResult> {
  const config = await getContactConfig(data.restaurantId)
  const { subject, text } = buildContactEmail(data.submission, {
    senderWaId: data.senderWaId,
    contactName: data.contactName,
    timestamp: new Date(data.submittedAt),
    labels: config.labels,
  })
  return getEmailProvider().send({ to: data.notificationEmail, subject, text })
}

export function isPermanentFailure(result: EmailSendResult): boolean {
  const error = result.error
  if (!error) return false
  if (error.title === 'resend_not_configured') return true
  // A 2xx with no parseable id means the request likely already reached
  // Resend — retrying risks sending the notification twice. Treating this as
  // permanent trades "needs a human to check Resend's dashboard" for "never
  // silently double-sends" (PR #106 review finding).
  if (error.title === 'resend_no_message_id') return true
  if (error.title !== 'resend_non_2xx') return false

  const status = parseHttpStatus(error.details)
  return status !== null && status >= 400 && status < 500 && !RETRYABLE_4XX_STATUSES.has(status)
}

function parseHttpStatus(details: string | undefined): number | null {
  const match = details ? HTTP_STATUS_RE.exec(details) : null
  return match ? parseInt(match[1], 10) : null
}

/** Distinct, observable dead-letter event (Slack via notify-ops-alert.ts +
 * a structured console.error) — the point of ISSUE-77 is that a failed send
 * survives to be seen, not just logged and dropped. */
async function alertDeadLetter(
  data: EmailJobData,
  error: { title: string; details?: string }
): Promise<void> {
  console.error('[EmailQueue] dead_letter', {
    restaurantId: data.restaurantId,
    messageId: data.messageId,
    error,
  })
  try {
    await notifyOpsAlert({
      kind: 'engineering_alert',
      severity: 'error',
      restaurantId: data.restaurantId,
      message: `Contact-form email dead-lettered: ${error.title}`,
      details: { messageId: data.messageId, ...error },
    })
  } catch (err) {
    // notifyOpsAlert is documented never to throw; this is belt-and-suspenders
    // so a regression there can't turn a dead-letter into an unhandled throw.
    console.warn('[EmailQueue] ops_alert_threw', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Worker 'failed' listener hook: alerts once retries are exhausted on a
 * TRANSIENT failure. The permanent path already alerted before throwing
 * `UnrecoverableError`, so it's excluded here to avoid double-alerting. */
export async function handleExhaustedRetries(
  job: { data: EmailJobData; attemptsMade: number; opts: { attempts?: number } },
  err: Error
): Promise<void> {
  if (err instanceof UnrecoverableError) return
  const maxAttempts = job.opts.attempts ?? 3
  if (job.attemptsMade < maxAttempts) return
  await alertDeadLetter(job.data, { title: 'retries_exhausted', details: err.message })
}
