import { upsertOpenWindow } from '@/infrastructure/supabase/repositories/conversation-window-repository'
import { ConversationWindow } from '@/domain/entities/conversation-window'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

// Local narrow LogFn (no 'critical') — matches `handlers.ts`'s LogFn so a
// plain handler logger can be passed through without widening. The window
// upsert path only ever emits 'error', so the narrower union is sufficient.
type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void

/**
 * WAQ-008: every inbound bumps the customer-service window. Failure is
 * non-fatal — the tenant still gets a reply; analytics/billing may
 * misattribute this single event but the inbound flow MUST not break.
 *
 * Anchors the 24h window on the user's original message timestamp, not
 * server-receive time. Meta calculates the customer-service window from
 * the user's send time; if a webhook is delayed/retried, anchoring on
 * `new Date()` would extend our tracked window past Meta's enforced
 * deadline and let outbound replies get blocked silently.
 */
export async function bumpServiceWindow(
  message: KapsoMessage,
  restaurantId: string,
  log: LogFn
): Promise<void> {
  try {
    const phoneE164 = PhoneNumber.create(message.from).value
    const messageAt = parseWebhookTimestamp(message.timestamp)
    await upsertOpenWindow(
      ConversationWindow.open({ restaurantId, phoneE164, now: messageAt })
    )
  } catch (err) {
    log('error', 'webhook.window_upsert_failed', { error: String(err) })
  }
}

/**
 * Parses a WhatsApp/Kapso webhook `timestamp` field into a `Date`.
 * Meta sends seconds-since-epoch as a string ("1774685162"); the Kapso
 * parser falls back to `new Date().toISOString()` when no timestamp is on
 * the upstream payload. Both shapes are accepted — anything unparseable
 * falls back to server time so the window still opens.
 */
export function parseWebhookTimestamp(raw: string | undefined): Date {
  if (!raw) return new Date()
  if (/^\d+$/.test(raw)) {
    const seconds = Number.parseInt(raw, 10)
    if (Number.isFinite(seconds)) return new Date(seconds * 1000)
  }
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? new Date(ms) : new Date()
}
