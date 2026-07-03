// WONB-004: small pure helpers for the import wizard orchestrator. Kept
// separate so the orchestrator stays under the 150-LoC file ceiling.

import { ImportBatch } from '@/domain/entities/import-batch'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'
import type {
  ImportContactsBatchInput,
  ImportContactsBatchResult,
} from './import-contacts-batch'

export function countByGrade(
  buckets: ConsentGrade[]
): ImportContactsBatchResult['gradeBreakdown'] {
  const acc = { strong: 0, medium: 0, weak: 0, none: 0 }
  for (const g of buckets) acc[g]++
  return acc
}

export interface BuildBatchArgs {
  input: ImportContactsBatchInput
  batchId: string
  breakdown: ImportContactsBatchResult['gradeBreakdown']
  inserted: number
  now: Date
}

export function buildBatchEntity(args: BuildBatchArgs): ImportBatch {
  const { input, batchId, breakdown, inserted, now } = args
  return ImportBatch.create({
    id: batchId,
    restaurantId: input.restaurantId,
    source: input.metadata.source,
    dateRangeStart: input.metadata.dateRangeStart,
    dateRangeEnd: input.metadata.dateRangeEnd,
    consentTextShown: input.metadata.consentTextShown,
    consentChannel: input.metadata.consentChannel,
    proofUrl: input.metadata.proofUrl,
    rowCount: inserted,
    strongCount: breakdown.strong,
    mediumCount: breakdown.medium,
    weakCount: breakdown.weak,
    noneCount: breakdown.none,
    createdBy: input.createdBy,
    now,
  })
}

// B5: zero-count placeholder for the up-front insert. Real counts arrive via
// updateImportBatchCounts after fan-out so a mid-batch crash never leaves
// orphan consent_records pointing at a missing batch row.
export function buildPlaceholderBatchEntity(args: {
  input: ImportContactsBatchInput
  batchId: string
  now: Date
}): ImportBatch {
  return buildBatchEntity({
    input: args.input,
    batchId: args.batchId,
    breakdown: { strong: 0, medium: 0, weak: 0, none: 0 },
    inserted: 0,
    now: args.now,
  })
}
