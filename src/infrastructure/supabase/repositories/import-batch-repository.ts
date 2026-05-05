// INVARIANT (WONB-004): SOLE writer to `import_batch`. The service-role
// client bypasses RLS — the table has no INSERT/UPDATE policies by design.
// Route every mutation through the named functions below.

import { createServerSupabaseClient } from '../client'
import { ImportBatch } from '@/domain/entities/import-batch'
import type {
  ImportBatchCountUpdate,
  ImportBatchRepository,
} from '@/domain/repositories/import-batch-repository'
import { toEntity, toInsertRow, type ImportBatchRow } from './import-batch-mapper'

const TABLE = 'import_batch'

export async function insertImportBatch(batch: ImportBatch): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.from(TABLE).insert(toInsertRow(batch))
  if (error) throw new Error(`insertImportBatch: ${error.message}`)
}

// B5: patch the count fields after a successful fan-out. Touches only the
// numeric columns — restaurant_id, source, dates, channel, proof_url, and
// created_by/at remain whatever the placeholder insert wrote.
export async function updateImportBatchCounts(
  id: string,
  update: ImportBatchCountUpdate
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from(TABLE)
    .update({
      row_count: update.rowCount,
      strong_count: update.gradeBreakdown.strong,
      medium_count: update.gradeBreakdown.medium,
      weak_count: update.gradeBreakdown.weak,
      none_count: update.gradeBreakdown.none,
    })
    .eq('id', id)
  if (error) throw new Error(`updateImportBatchCounts: ${error.message}`)
}

export async function findByRestaurant(
  restaurantId: string,
  limit: number
): Promise<ImportBatch[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`findByRestaurant: ${error.message}`)
  return ((data ?? []) as ImportBatchRow[]).map(toEntity)
}

// Compile-time contract lock against the domain port — TS surfaces drift here.
export const importBatchRepository: ImportBatchRepository = {
  insertBatch: insertImportBatch,
  updateBatchCounts: updateImportBatchCounts,
  findByRestaurant,
}
