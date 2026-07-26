/**
 * REPLY-008: accept a web contact-form submission.
 *
 * The web counterpart of `contact-form-handler.ts`'s Flow path, converging on
 * the same `ContactFormSubmission` + `buildContactEmail` so the restaurant's
 * notification looks identical whichever rung produced it.
 *
 * Ordering differs from the Flow path deliberately. There, the ack is sent
 * first because the customer is sitting in WhatsApp waiting for one. Here the
 * customer's confirmation is the page itself, so the EMAIL — the part the
 * restaurant depends on — is sent first, and the WhatsApp ack is best-effort
 * afterwards. An ack failure must never cost the restaurant the enquiry.
 */
import {
  getContactConfig,
  getRestaurantEmailContext,
  getRestaurantPhoneNumberId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { consumeContactFormToken } from '@/infrastructure/supabase/repositories/contact-form-token-repository'
import { getEmailProvider } from '@/infrastructure/email/provider-factory'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { buildContactEmail } from '@/domain/services/contact-email'
import { DEFAULT_ACK_TEXT } from '@/domain/services/contact-config'
import { parseWebFormSubmission } from '@/domain/services/contact-web-form'

export type SubmitContactWebFormResult =
  | { ok: true }
  | { ok: false; reason: 'token_unusable' | 'invalid_submission' | 'email_failed'; detail?: string }

/**
 * `token_unusable` covers expired, already-consumed, and never-existed alike.
 * The three are deliberately indistinguishable to the caller: telling an
 * anonymous poster which of them applies would confirm whether a given token
 * value ever existed, and every one of them leads to the same recovery UI.
 */
export async function submitContactWebForm(
  token: string,
  body: unknown
): Promise<SubmitContactWebFormResult> {
  // Claimed BEFORE anything is parsed or sent. This is the single point that
  // makes a link one-off — not the client's modal dismissal, which may never
  // run (tab closed, signal lost, WebView killed). A losing concurrent submit
  // gets null here and stops, so the restaurant receives exactly one email.
  const owner = await consumeContactFormToken(token)
  if (!owner) return { ok: false, reason: 'token_unusable' }

  const config = await getContactConfig(owner.restaurantId)
  const parsed = parseWebFormSubmission(body, owner.phone, config.topics)
  if (!parsed.ok) {
    // The token is already burnt. That is the safe direction to fail: a
    // rejected body means a tampered or broken client, and re-arming the token
    // would hand it another attempt. A genuine customer recovers the same way
    // as any expired link — one tap to request a new one.
    return { ok: false, reason: 'invalid_submission', detail: parsed.reason }
  }

  const restaurant = await getRestaurantEmailContext(owner.restaurantId)
  const { subject, text } = buildContactEmail(parsed.submission, {
    senderWaId: owner.phone,
    restaurantName: restaurant.name,
    restaurantWhatsappNumber: restaurant.whatsappNumber ?? '',
    timestamp: new Date(),
    // No WhatsApp message id exists for a web submission — the enquiry did not
    // arrive as a message. Labelled rather than blanked so a restaurant
    // reading the email knows which channel it came from.
    messageId: 'web-form',
  })

  if (!config.notificationEmail) {
    return { ok: false, reason: 'email_failed', detail: 'no_notification_email' }
  }

  const sent = await getEmailProvider().send({ to: config.notificationEmail, subject, text })
  if (!sent.ok) {
    return { ok: false, reason: 'email_failed', detail: String(sent.error ?? 'send_failed') }
  }

  await sendAckBestEffort(owner.restaurantId, owner.phone, config.ackText)
  return { ok: true }
}

/**
 * The ack rides WhatsApp's 24-hour service window, which the 30-minute token
 * TTL is sized to stay inside — but a delayed queue or a customer who somehow
 * submits at the edge can still fall outside it, and Meta then rejects the
 * send ("Cannot send non-template messages outside the 24-hour window").
 * Never fatal: the page has already told the customer they are done.
 */
async function sendAckBestEffort(
  restaurantId: string,
  phone: string,
  ackText: string | null
): Promise<void> {
  try {
    const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
    if (!phoneNumberId) return
    const result = await sendTextMessage(phoneNumberId, phone, ackText ?? DEFAULT_ACK_TEXT)
    if (!result.ok) {
      console.warn('[ContactForm] web ack send failed:', result.error)
    }
  } catch (err) {
    console.warn('[ContactForm] web ack threw:', (err as Error).message)
  }
}
