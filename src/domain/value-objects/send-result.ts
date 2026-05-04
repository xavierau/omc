/**
 * Outcome of a WhatsApp send call. The `kapsoMessageId` is the `wamid...`
 * the BSP returns and is the only way we can correlate the outbound row in
 * `whatsapp_messages` with downstream status webhooks.
 *
 * `ok=true` requires a non-null `kapsoMessageId`. Adapters that legitimately
 * skip the network (e.g. no API key) return `ok=false` with `error.title`
 * describing the skip reason.
 */
export interface SendResult {
  ok: boolean
  kapsoMessageId: string | null
  raw: Record<string, unknown> | null
  error?: { title: string; details?: string }
}
