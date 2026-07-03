// WONB-004: per-row fan-out for the import wizard orchestrator. Pulled out
// of the orchestrator file to honour the file-LoC + 1-responsibility-per-file
// rules. B5: each row is wrapped in try/catch so a thrown row error never
// aborts the whole batch — surviving rows still commit and the orchestrator
// patches the batch counts with what it actually inserted.

import { importOneContactRow } from './import-contacts-batch-row'
import type { ImportContactsBatchInput, ImportRowReject } from './import-contacts-batch'
import type { PreflightAcceptedRow } from './import-contacts-batch-validation'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'

export interface FanOutArgs {
  input: ImportContactsBatchInput
  batchId: string
  grade: ConsentGrade
  rows: PreflightAcceptedRow[]
}

export interface FanOutResult {
  inserted: number
  membersCreated: number
  gradeBuckets: ConsentGrade[]
  rejected: ImportRowReject[]
}

export async function fanOutRows(args: FanOutArgs): Promise<FanOutResult> {
  const meta = buildRowMeta(args.input, args.batchId)
  const out: FanOutResult = { inserted: 0, membersCreated: 0, gradeBuckets: [], rejected: [] }
  for (const row of args.rows) {
    await runOneRow({ input: args.input, grade: args.grade, meta, row, out })
  }
  return out
}

function buildRowMeta(input: ImportContactsBatchInput, batchId: string) {
  return {
    source: input.metadata.source,
    consentChannel: input.metadata.consentChannel,
    consentTextShown: input.metadata.consentTextShown,
    proofUrl: input.metadata.proofUrl,
    importBatchId: batchId,
    capturedAt: input.metadata.dateRangeEnd,
  }
}

interface RunOneRowArgs {
  input: ImportContactsBatchInput
  grade: ConsentGrade
  meta: ReturnType<typeof buildRowMeta>
  row: PreflightAcceptedRow
  out: FanOutResult
}

async function runOneRow(args: RunOneRowArgs): Promise<void> {
  const { input, grade, meta, row, out } = args
  try {
    const outcome = await importOneContactRow({
      restaurantId: input.restaurantId,
      mergeExistingMembers: input.mergeExistingMembers,
      grade,
      meta,
      row: { phoneE164: row.phoneE164, name: row.name, preferredLanguage: row.preferredLanguage },
    })
    if (outcome.ok) {
      out.inserted++
      if (outcome.created) out.membersCreated++
      out.gradeBuckets.push(outcome.gradeBucket)
    } else out.rejected.push(outcome.reject)
  } catch (err) {
    out.rejected.push({
      phoneE164: row.phoneE164,
      reason: 'duplicate_active',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
