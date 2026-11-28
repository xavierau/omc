/**
 * BOOK-001 W2: `inbound_classifications` (migration 082; spec AC-7, R17).
 *
 * A plain INSERT; UNIQUE (restaurant_id, message_id) turns a webhook retry
 * into Postgres 23505, reported as `duplicate` with the outcome stored then
 * (one extra SELECT, on retries only) so the caller replies again only if it
 * never did (BOOK-012 r2). Never throws and never logs the row (it holds no
 * text, but the error message could echo values).
 */
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import type {
  ClassificationOutcome,
  InboundClassificationRow,
  InboundClassificationStore,
  RecordClassificationResult,
} from '@/domain/ports/inbound-classification'

const UNIQUE_VIOLATION = '23505'
const OUTCOMES: readonly ClassificationOutcome[] = ['booking_reply', 'fallback', 'error']

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
    if (!error) return { status: 'recorded' }
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return { status: 'duplicate', earlierOutcome: await findStoredOutcome(row) }
    }
    console.warn('[Booking] classification record failed:', (error as { code?: string }).code ?? 'unknown')
    return { status: 'failed' }
  } catch (err) {
    console.warn('[Booking] classification record threw:', (err as Error).name)
    return { status: 'failed' }
  }
}

/** The outcome recorded for this wamid, or null when it cannot be read. */
async function findStoredOutcome(row: InboundClassificationRow): Promise<ClassificationOutcome | null> {
  try {
    const { data, error } = await createServerSupabaseClient()
      .from('inbound_classifications')
      .select('outcome')
      .eq('restaurant_id', row.restaurantId)
      .eq('message_id', row.messageId)
      .maybeSingle()
    if (error) console.warn('[Booking] classification lookup failed:', (error as { code?: string }).code ?? 'unknown')
    const outcome = (data as { outcome?: unknown } | null)?.outcome
    return OUTCOMES.find((o) => o === outcome) ?? null
  } catch (err) {
    console.warn('[Booking] classification lookup threw:', (err as Error).name)
    return null
  }
}

export const inboundClassificationStore: InboundClassificationStore = {
  record: recordInboundClassification,
}
