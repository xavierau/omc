// WONB-004: orchestrator for the contact import wizard.
// Order (B5): validate metadata → grade → INSERT placeholder batch row →
// fan out per-row inserts (each wrapped in try/catch) → UPDATE counts.
// The up-front placeholder insert means a mid-batch crash leaves consent
// rows pointing at an existing — though incomplete — batch row instead of
// orphaning them with import_batch_id=NULL.

import { randomUUID } from 'crypto'
import {
  ImportBatchValidationError,
  type ImportRowRejectReason,
} from '@/domain/services/__errors__/import-errors'
import { gradeConsent } from '@/domain/services/grade-consent-batch'
import {
  insertImportBatch,
  updateImportBatchCounts,
} from '@/infrastructure/supabase/repositories/import-batch-repository'
import {
  validatePreflight,
  type PreflightMetadata,
  type PreflightResult,
} from './import-contacts-batch-validation'
import { fanOutRows } from './import-contacts-batch-fanout'
import { assignTagsToImportedMembers } from './assign-tags-to-imported-members'
import {
  buildPlaceholderBatchEntity,
  countByGrade,
} from './import-contacts-batch-helpers'

export interface ImportContactsBatchInput {
  restaurantId: string
  createdBy: string | null
  metadata: PreflightMetadata
  rows: Array<{
    phoneE164: string
    name?: string | null
    preferredLanguage?: 'en' | 'zh_hk' | null
  }>
  mergeExistingMembers: boolean
  // TAG-001: tags to apply to every member created OR merged in this batch.
  tagIds: string[]
  now?: Date
}

export interface ImportRowReject {
  phoneE164: string
  reason: ImportRowRejectReason
  message?: string
}

export interface ImportContactsBatchResult {
  importBatchId: string
  inserted: number
  membersCreated: number
  rejected: ImportRowReject[]
  gradeBreakdown: { strong: number; medium: number; weak: number; none: number }
}

export async function importContactsBatch(
  input: ImportContactsBatchInput
): Promise<ImportContactsBatchResult> {
  const now = input.now ?? new Date()
  const preflight = preflightOrThrow(input, now)
  const batchId = randomUUID()
  const grade = gradeBatch(input, now)
  // B5: insert the batch row up-front with placeholder counts so per-row
  // FK references resolve even if fan-out crashes part-way.
  await insertImportBatch(buildPlaceholderBatchEntity({ input, batchId, now }))
  const fanOut = await fanOutRows({ input, batchId, grade, rows: preflight.acceptedRows })
  const breakdown = countByGrade(fanOut.gradeBuckets)
  await updateImportBatchCounts(batchId, { rowCount: fanOut.inserted, gradeBreakdown: breakdown })
  await maybeAssignImportTags(input, fanOut.memberIds)
  return {
    importBatchId: batchId,
    inserted: fanOut.inserted,
    membersCreated: fanOut.membersCreated,
    rejected: [...preflight.rejected, ...fanOut.rejected],
    gradeBreakdown: breakdown,
  }
}

// TAG-001: after the fan-out, apply the wizard's tags to every member the
// batch touched. ONE bulk call (not per-row); nulls filtered here, tenant
// ownership of the tags is re-asserted inside assignTagsToImportedMembers.
async function maybeAssignImportTags(
  input: ImportContactsBatchInput,
  memberIds: Array<string | null>
): Promise<void> {
  if (input.tagIds.length === 0) return
  await assignTagsToImportedMembers({
    restaurantId: input.restaurantId,
    memberIds: memberIds.filter(Boolean),
    tagIds: input.tagIds,
  })
}

function preflightOrThrow(
  input: ImportContactsBatchInput,
  now: Date
): PreflightResult {
  if (input.rows.length === 0) {
    throw new ImportBatchValidationError('empty_rows')
  }
  const preflight = validatePreflight({ metadata: input.metadata, rows: input.rows, now })
  throwOnMetadataError(preflight)
  return preflight
}

function gradeBatch(input: ImportContactsBatchInput, now: Date) {
  return gradeConsent({
    channel: input.metadata.consentChannel,
    consentTextShown: input.metadata.consentTextShown,
    dateRangeEnd: input.metadata.dateRangeEnd,
    now,
  })
}

function throwOnMetadataError(preflight: PreflightResult): void {
  if (!preflight.metadataError) return
  throw new ImportBatchValidationError(
    preflight.metadataError.reason,
    preflight.metadataError.message
  )
}

