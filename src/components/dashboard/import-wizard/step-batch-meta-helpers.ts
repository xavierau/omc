/**
 * Pure client-side validators for the import-wizard Step 1 (batch metadata).
 * Mirrors AC #1 in WONB-004 plan. Server is the source of truth.
 */

export type ConsentChannel = 'whatsapp' | 'generic' | 'service_only' | 'none'

export type BatchMetaError =
  | 'source_required'
  | 'consent_text_too_short'
  | 'date_range_invalid'
  | 'date_range_future'
  | 'proof_required_for_whatsapp'

export interface BatchMetaInput {
  source: string
  dateRangeStart: string
  dateRangeEnd: string
  consentTextShown: string
  consentChannel: ConsentChannel
  proofFilePresent: boolean
}

const MIN_CONSENT_TEXT = 10

export function validateBatchMeta(input: BatchMetaInput, today: string): BatchMetaError[] {
  const errors: BatchMetaError[] = []
  if (input.source.trim().length === 0) errors.push('source_required')
  if (input.consentTextShown.trim().length < MIN_CONSENT_TEXT) {
    errors.push('consent_text_too_short')
  }
  if (!isValidRange(input.dateRangeStart, input.dateRangeEnd)) {
    errors.push('date_range_invalid')
  } else if (input.dateRangeEnd > today) {
    errors.push('date_range_future')
  }
  if (input.consentChannel === 'whatsapp' && !input.proofFilePresent) {
    errors.push('proof_required_for_whatsapp')
  }
  return errors
}

function isValidRange(start: string, end: string): boolean {
  if (!start || !end) return false
  return end >= start
}
