import { ImportBatchValidationError } from '@/domain/services/__errors__/import-errors'
import { tagKey } from '@/domain/services/normalize-import-tags'
import { tagRepository } from '@/infrastructure/supabase/repositories/tag-repository'
import { assignTagsToImportedMembers } from './assign-tags-to-imported-members'
import { assignRowTagsToImportedMembers } from './assign-row-tags-to-imported-members'
import type { ImportContactsBatchInput } from './import-contacts-batch'
import type { FanOutResult } from './import-contacts-batch-fanout'
import type { PreflightAcceptedRow } from './import-contacts-batch-validation'

/** A malformed CSV column headed `tags` (e.g. free-text notes) would otherwise
 *  mint hundreds of tags with no bulk-delete UI to undo it (plan R-2). */
export const MAX_NEW_TAGS_PER_IMPORT = 50

export interface ImportTaggingResult {
  status: 'ok' | 'failed'
  /** Distinct members that received at least one tag, across both paths. */
  taggedMembers: number
}

/**
 * Cap check — runs BEFORE any write (AM-1), so tripping it leaves zero
 * import_batch rows, zero consent_records and zero tags behind.
 */
export async function assertNewTagBudget(
  restaurantId: string,
  rows: PreflightAcceptedRow[]
): Promise<void> {
  const keys = distinctTagKeys(rows)
  if (keys.size === 0) return
  const existing = await tagRepository.listByRestaurant(restaurantId)
  for (const tag of existing) keys.delete(tagKey(tag.name))
  if (keys.size <= MAX_NEW_TAGS_PER_IMPORT) return
  throw new ImportBatchValidationError(
    'too_many_new_tags',
    `This file would create ${keys.size} new tags (limit ${MAX_NEW_TAGS_PER_IMPORT}). ` +
      'No contacts were imported — nothing was written. Check that the `tags` ' +
      'column is not free text, then try again.'
  )
}

function distinctTagKeys(rows: PreflightAcceptedRow[]): Set<string> {
  const keys = new Set<string>()
  for (const row of rows) {
    for (const name of row.tags) keys.add(tagKey(name))
  }
  return keys
}

export interface TagPhaseArgs {
  input: ImportContactsBatchInput
  fanOut: FanOutResult
}

/**
 * Best-effort tag phase (AM-1). It runs strictly after the consent fan-out and
 * the batch count update, and is keyed only off member ids that fan-out
 * returned (plan invariant 3). A failure here is reported on the result, never
 * thrown: the contacts and their consent records are already committed and
 * correct, so failing the whole request would misreport a successful import.
 */
export async function runImportTagPhase(
  args: TagPhaseArgs
): Promise<ImportTaggingResult> {
  const { input, fanOut } = args
  try {
    await assignBatchTags(input, fanOut.memberIds)
    const { taggedMembers } = await assignRowTags(input.restaurantId, fanOut.taggedRows)
    return { status: 'ok', taggedMembers: Math.max(batchTagged(input, fanOut), taggedMembers) }
  } catch (err) {
    console.error('importContactsBatch: tag phase failed', err)
    return { status: 'failed', taggedMembers: 0 }
  }
}

async function assignBatchTags(
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

async function assignRowTags(
  restaurantId: string,
  rows: FanOutResult['taggedRows']
): Promise<{ taggedMembers: number }> {
  if (rows.length === 0) return { taggedMembers: 0 }
  return assignRowTagsToImportedMembers({ restaurantId, rows })
}

/**
 * Batch-level tags cover EVERY member the fan-out resolved, which is a superset
 * of the per-row tagged members — so the union of the two sets is just the
 * larger count, no id bookkeeping required.
 */
function batchTagged(input: ImportContactsBatchInput, fanOut: FanOutResult): number {
  if (input.tagIds.length === 0) return 0
  return new Set(fanOut.memberIds.filter((id): id is string => Boolean(id))).size
}
