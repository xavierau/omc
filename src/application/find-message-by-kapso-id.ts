import { findMessageByKapsoId } from '@/infrastructure/supabase/repositories/whatsapp-message-repository'
import type { WhatsAppMessage } from '@/domain/entities/whatsapp-message'

const RETRY_DELAY_MS = 250

/**
 * Webhook-handler lookup with one bounded retry. Covers the §4.2 race where
 * the BSP-returned wamid arrives at our webhook *before* `recordOutboundSend`
 * has UPDATEd the row with the kapso id. WAQ-002 will key webhook
 * idempotency claim/release behaviour off this helper's null result.
 */
export async function findMessageByKapsoIdWithRetry(
  kapsoMessageId: string
): Promise<WhatsAppMessage | null> {
  const first = await findMessageByKapsoId(kapsoMessageId)
  if (first) return first
  await delay(RETRY_DELAY_MS)
  return findMessageByKapsoId(kapsoMessageId)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
