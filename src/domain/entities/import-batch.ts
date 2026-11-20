// WONB-004: per-batch audit row written at the end of a successful wizard
// commit. Validation rules mirror the DB CHECKs in migration 048 plus the
// AC #1 rules in docs/tasks/wonb-004-plan.md so callers fail fast at the
// domain boundary before a round-trip.

import { isConsentChannel, type ConsentChannel } from '@/domain/value-objects/consent-channel'
import { ImportBatchValidationError } from '@/domain/services/__errors__/import-errors'

const MIN_CONSENT_TEXT_LEN = 10

export interface ImportBatchProps {
  id: string
  restaurantId: string
  source: string
  dateRangeStart: string         // ISO date (yyyy-mm-dd or full ISO)
  dateRangeEnd: string
  consentTextShown: string
  consentChannel: ConsentChannel
  proofUrl: string | null
  rowCount: number
  strongCount: number
  mediumCount: number
  weakCount: number
  noneCount: number
  createdBy: string | null
  createdAt: string
}

export interface CreateImportBatchInput {
  id: string
  restaurantId: string
  source: string
  dateRangeStart: Date
  dateRangeEnd: Date
  consentTextShown: string
  consentChannel: ConsentChannel
  proofUrl: string | null
  rowCount: number
  strongCount: number
  mediumCount: number
  weakCount: number
  noneCount: number
  createdBy: string | null
  now?: Date
}

export class ImportBatch {
  private constructor(private readonly props: ImportBatchProps) {}

  static create(input: CreateImportBatchInput): ImportBatch {
    validateMetadata(input)
    const now = input.now ?? new Date()
    return new ImportBatch({
      id: input.id,
      restaurantId: input.restaurantId,
      source: input.source.trim(),
      dateRangeStart: input.dateRangeStart.toISOString(),
      dateRangeEnd: input.dateRangeEnd.toISOString(),
      consentTextShown: input.consentTextShown,
      consentChannel: input.consentChannel,
      proofUrl: input.proofUrl ?? null,
      rowCount: input.rowCount,
      strongCount: input.strongCount,
      mediumCount: input.mediumCount,
      weakCount: input.weakCount,
      noneCount: input.noneCount,
      createdBy: input.createdBy,
      createdAt: now.toISOString(),
    })
  }

  static fromProps(props: ImportBatchProps): ImportBatch {
    return new ImportBatch(props)
  }

  get snapshot(): Readonly<ImportBatchProps> {
    return this.props
  }
}

function validateMetadata(input: CreateImportBatchInput): void {
  if (typeof input.source !== 'string' || input.source.trim().length === 0) {
    throw new ImportBatchValidationError('empty_source')
  }
  if (
    typeof input.consentTextShown !== 'string' ||
    input.consentTextShown.trim().length < MIN_CONSENT_TEXT_LEN
  ) {
    throw new ImportBatchValidationError('short_consent_text')
  }
  if (!isConsentChannel(input.consentChannel)) {
    throw new ImportBatchValidationError('invalid_consent_channel')
  }
  if (input.dateRangeEnd.getTime() < input.dateRangeStart.getTime()) {
    throw new ImportBatchValidationError('invalid_date_range')
  }
  const today = startOfDay(input.now ?? new Date())
  const endDay = startOfDay(input.dateRangeEnd)
  if (endDay.getTime() > today.getTime()) {
    throw new ImportBatchValidationError('future_date_range')
  }
  if (input.consentChannel === 'whatsapp' && !input.proofUrl) {
    throw new ImportBatchValidationError('whatsapp_proof_required')
  }
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
