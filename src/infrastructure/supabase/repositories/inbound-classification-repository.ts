/**
 * BOOK-001 W2: `inbound_classifications` (migration 082; spec AC-7, R17).
 *
 * A plain INSERT; UNIQUE (restaurant_id, message_id) turns a webhook retry
 * into Postgres 23505, reported as `duplicate` so the caller does not reply
 * twice. Never throws and never logs the row (it holds no text, but the
 * error message could echo values).
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type {
  InboundClassificationRow,
  InboundClassificationStore,
  RecordClassificationResult,
} from '@/domain/ports/inbound-classification'

const UNIQUE_VIOLATION = '23505'

export async function recordInboundClassification(row: InboundClassificationRow): Promise<RecordClassificationResult> {
  try {
    const supabase = createServerSupabaseClient()
    const { error } = await supabase.from('inbound_classifications').insert({
      restaurant_id: row.restaurantId,
      message_id: row.messageId,
      label: row.label,
      confidence: row.confidence,
      outcome: row.outcome,
    })
    if (!error) return 'recorded'
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'duplicate'
    console.warn('[Booking] classification record failed:', (error as { code?: string }).code ?? 'unknown')
    return 'failed'
  } catch (err) {
    console.warn('[Booking] classification record threw:', (err as Error).name)
    return 'failed'
  }
}

export const inboundClassificationStore: InboundClassificationStore = {
  record: recordInboundClassification,
}
