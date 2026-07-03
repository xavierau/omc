// WONB-004 — Stream C: pure preview twin of importContactsBatch.
// Mirrors the metadata + row validation but performs ZERO database writes.
// Returns the batch-level grade plus per-row preview grades so the wizard
// can render the breakdown table without committing.

import { gradeConsent } from '@/domain/services/grade-consent-batch'
import { ImportBatch } from '@/domain/entities/import-batch'
import { ImportBatchValidationError } from '@/domain/services/__errors__/import-errors'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'
import type { ConsentChannel } from '@/domain/value-objects/consent-channel'
import type { ImportRowReject } from './import-contacts-batch'

export interface PreviewBatchMetadata {
  source: string
  dateRangeStart: Date
  dateRangeEnd: Date
  consentTextShown: string
  consentChannel: ConsentChannel
  proofUrl: string | null
}

export interface PreviewContactsBatchInput {
  restaurantId: string
  metadata: PreviewBatchMetadata
  rows: Array<{
    phoneE164: string
    name?: string | null
    preferredLanguage?: 'en' | 'zh_hk' | null
  }>
  now?: Date
}

export interface PreviewRow {
  phoneE164: string
  name: string | null
  grade: ConsentGrade
}

export interface PreviewContactsBatchResult {
  batchGrade: ConsentGrade
  rows: PreviewRow[]
  gradeBreakdown: {
    strong: number
    medium: number
    weak: number
    none: number
  }
  rejected: ImportRowReject[]
}

const ZERO_BREAKDOWN = { strong: 0, medium: 0, weak: 0, none: 0 } as const

export async function previewContactsBatch(
  input: PreviewContactsBatchInput
): Promise<PreviewContactsBatchResult> {
  const now = input.now ?? new Date()
  if (input.rows.length === 0) {
    throw new ImportBatchValidationError('empty_rows')
  }
  // Validate metadata identically to the commit path. Throws
  // ImportBatchValidationError on any failure → route maps to 400.
  validateMetadata(input, now)
  const batchGrade = gradeConsent({
    channel: input.metadata.consentChannel,
    consentTextShown: input.metadata.consentTextShown,
    dateRangeEnd: input.metadata.dateRangeEnd,
    now,
  })
  const { rows, rejected } = classifyRows(input.rows, batchGrade)
  return {
    batchGrade,
    rows,
    gradeBreakdown: { ...ZERO_BREAKDOWN, [batchGrade]: rows.length },
    rejected,
  }
}

function validateMetadata(
  input: PreviewContactsBatchInput,
  now: Date
): void {
  // ImportBatch.create encodes the same invariants as the DB CHECKs so we
  // fail fast at the domain boundary. We use placeholder count fields since
  // preview doesn't know inserted counts yet.
  ImportBatch.create({
    id: '00000000-0000-0000-0000-000000000000',
    restaurantId: input.restaurantId,
    source: input.metadata.source,
    dateRangeStart: input.metadata.dateRangeStart,
    dateRangeEnd: input.metadata.dateRangeEnd,
    consentTextShown: input.metadata.consentTextShown,
    consentChannel: input.metadata.consentChannel,
    proofUrl: input.metadata.proofUrl,
    rowCount: 0,
    strongCount: 0,
    mediumCount: 0,
    weakCount: 0,
    noneCount: 0,
    createdBy: null,
    now,
  })
}

interface ClassifyResult {
  rows: PreviewRow[]
  rejected: ImportRowReject[]
}

function classifyRows(
  inputRows: PreviewContactsBatchInput['rows'],
  grade: ConsentGrade
): ClassifyResult {
  const seen = new Set<string>()
  const rows: PreviewRow[] = []
  const rejected: ImportRowReject[] = []
  for (const row of inputRows) {
    const normalized = tryNormalize(row.phoneE164)
    if (!normalized) {
      rejected.push({ phoneE164: row.phoneE164, reason: 'invalid_phone' })
      continue
    }
    if (seen.has(normalized)) {
      rejected.push({
        phoneE164: row.phoneE164,
        reason: 'duplicate_phone_in_batch',
      })
      continue
    }
    seen.add(normalized)
    rows.push({ phoneE164: normalized, name: row.name ?? null, grade })
  }
  return { rows, rejected }
}

function tryNormalize(raw: string): string | null {
  try {
    return PhoneNumber.create(raw).value
  } catch {
    return null
  }
}
