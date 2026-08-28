// WONB-004: typed errors for the contact import wizard.
// API routes map each error name + reason to an HTTP status. Reasons are
// machine-readable and surfaced verbatim in the per-row reject report.

export type ImportBatchValidationReason =
  | 'empty_source'
  | 'short_consent_text'
  | 'invalid_date_range'
  | 'future_date_range'
  | 'whatsapp_proof_required'
  | 'invalid_consent_channel'
  | 'empty_rows'
  // TAG-001 R-2: a free-text column headed `tags` would mint hundreds of tags.
  // Checked BEFORE any write, so the import is rejected whole (AM-1).
  | 'too_many_new_tags'

export class ImportBatchValidationError extends Error {
  constructor(
    public readonly reason: ImportBatchValidationReason,
    message?: string
  ) {
    super(message ?? reason)
    this.name = 'ImportBatchValidationError'
  }
}

export type ImportRowRejectReason =
  | 'phone_already_member'
  | 'duplicate_phone_in_batch'
  | 'duplicate_active'
  | 'invalid_phone'

export interface ImportRowRejectInput {
  reason: ImportRowRejectReason
  phoneE164: string
  message?: string
}

export class ImportRowRejectError extends Error {
  public readonly reason: ImportRowRejectReason
  public readonly phoneE164: string

  constructor(input: ImportRowRejectInput) {
    super(input.message ?? input.reason)
    this.name = 'ImportRowRejectError'
    this.reason = input.reason
    this.phoneE164 = input.phoneE164
  }
}
