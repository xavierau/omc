/**
 * BOOK-001 W2: one row per classified inbound message (spec AC-7, R17).
 * No text column by design. `duplicate` means this wamid was recorded
 * before (a webhook retry); the caller must not reply a second time.
 */
import type { IntentLabel } from './intent-classifier'

export type ClassificationOutcome = 'booking_reply' | 'fallback' | 'error'

export interface InboundClassificationRow {
  restaurantId: string
  messageId: string
  label: IntentLabel | null
  confidence: number | null
  outcome: ClassificationOutcome
}

export type RecordClassificationResult = 'recorded' | 'duplicate' | 'failed'

/** Never throws: a failed record must not cost the diner their reply. */
export interface InboundClassificationStore {
  record(row: InboundClassificationRow): Promise<RecordClassificationResult>
}
