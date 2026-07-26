/**
 * REPLY-005: WhatsApp Flow contact-form submission handler (AD-4, AD-8).
 *
 * Runs strictly after the idempotency claim (`route.ts:100-101`) — every
 * failure path here MUST resolve, never throw. A throw at this point in the
 * pipeline becomes a provider retry storm on an event that can never be
 * replayed (see comments at `route.ts:90-94`). `handleContactFormSubmission`
 * wraps the whole body so any unexpected error degrades to a logged 'error'
 * instead of an unhandled rejection.
 */
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { getContactConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { getEmailProvider } from '@/infrastructure/email/provider-factory'
import { parseContactFormSubmission } from '@/domain/services/contact-form-submission'
import { buildContactEmail, type ContactFormSubmission } from '@/domain/services/contact-email'
import { DEFAULT_ACK_TEXT } from '@/domain/services/contact-config'
import { handleUnknown } from './unknown-help-handlers'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

// Local narrow LogFn (no 'critical') — matches `handlers.ts`'s LogFn so a
// plain handler logger can be passed through without widening.
type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void

const TOKEN_PREFIX = 'cf.v1.'

export interface ContactFormSubmissionCtx {
  message: KapsoMessage
  restaurantId: string
  phoneNumberId: string
  phone: string
  log: LogFn
}

/** Entry point — never throws (see file header). */
export async function handleContactFormSubmission(ctx: ContactFormSubmissionCtx): Promise<void> {
  try {
    await process(ctx)
  } catch (err) {
    ctx.log('error', 'contact_form.unexpected_error', { error: String(err) })
  }
}

async function process(ctx: ContactFormSubmissionCtx) {
  const { message, restaurantId, phoneNumberId, phone, log } = ctx

  const parsed = parseContactFormSubmission(message.flowResponse)
  if (!parsed.ok) {
    log('warn', 'contact_form.invalid_payload', { reason: parsed.reason })
    return handleUnknown(phoneNumberId, phone, restaurantId)
  }

  const tokenCheck = checkToken(message.flowToken, restaurantId, log)
  if (tokenCheck === 'mismatch') return
  if (tokenCheck === 'foreign') return handleUnknown(phoneNumberId, phone, restaurantId)

  const config = await getContactConfig(restaurantId)
  await sendAck(phoneNumberId, phone, config.ackText, log)
  await sendNotification(parsed.submission, config.notificationEmail, ctx)
}

type TokenCheck = 'ok' | 'mismatch' | 'foreign'

/**
 * AD-4: tenant + contact identity NEVER depends on the token (the webhook's
 * own tenant resolution + `message.from` are authoritative) — this is a
 * defensive cross-tenant check only. Absent token → accept (webhook-derived
 * identity is enough) but log for visibility.
 */
function checkToken(token: string | undefined, restaurantId: string, log: LogFn): TokenCheck {
  if (token === undefined) {
    log('warn', 'contact_form.token_missing', { restaurantId })
    return 'ok'
  }
  if (!token.startsWith(TOKEN_PREFIX)) {
    log('warn', 'contact_form.foreign_token', { restaurantId })
    return 'foreign'
  }
  const tokenRestaurantId = token.slice(TOKEN_PREFIX.length).split('.')[0]
  if (tokenRestaurantId !== restaurantId) {
    log('warn', 'contact_form.token_mismatch', { restaurantId })
    return 'mismatch'
  }
  return 'ok'
}

/** Ack-first (AD-8): contact-facing reply is the latency-sensitive leg. */
async function sendAck(
  phoneNumberId: string,
  phone: string,
  ackText: string | null,
  log: LogFn
): Promise<void> {
  const result = await sendTextMessage(phoneNumberId, phone, ackText ?? DEFAULT_ACK_TEXT)
  if (!result.ok) {
    log('warn', 'contact_form.ack_send_failed', { error: result.error })
  }
}

/** Never affects the ack (already sent) and never throws — logged at 'error'. */
async function sendNotification(
  submission: ContactFormSubmission,
  notificationEmail: string | null,
  ctx: ContactFormSubmissionCtx
): Promise<void> {
  const { restaurantId, message, log } = ctx

  if (!notificationEmail) {
    log('warn', 'contact_form.no_notification_email', { restaurantId })
    return
  }

  const { subject, text } = buildContactEmail(submission, {
    senderWaId: ctx.phone,
    // WhatsApp's profile name when it supplied one, otherwise the member
    // record — Meta omits `contacts[].profile.name` often enough that
    // reporting "(未提供)" for a known member was a routine wrong answer.
    contactName: message.contactName ?? (await memberName(restaurantId, ctx.phone)),
    timestamp: new Date(),
    messageId: message.messageId,
  })

  const result = await getEmailProvider().send({ to: notificationEmail, subject, text })
  if (!result.ok) {
    log('error', 'contact_form.email_failed', { error: result.error, restaurantId })
  }
}

/** Best-effort: an unknown sender is simply an unnamed one, never an error. */
async function memberName(restaurantId: string, phone: string): Promise<string | undefined> {
  try {
    const member = await findMemberByPhone(restaurantId, phone)
    return member?.name ?? undefined
  } catch {
    return undefined
  }
}
