import type { ImportBatch } from '@/domain/entities/import-batch'

/**
 * Per-batch count update payload (B5). The orchestrator writes a placeholder
 * batch row first, fans out per-row inserts using the pre-generated id, then
 * patches the count fields here at the end. Only counts are updated — the
 * sole writer is the orchestrator on its own batch, so no optimistic
 * concurrency is needed.
 */
export interface ImportBatchCountUpdate {
  rowCount: number
  gradeBreakdown: { strong: number; medium: number; weak: number; none: number }
}

/**
 * Contract for the `import_batch` writer/reader (WONB-004). The Supabase
 * implementation is the SOLE writer (service-role client bypasses RLS); the
 * table has no INSERT/UPDATE policies by design.
 */
export interface ImportBatchRepository {
  /** Persist a fresh batch row at the end of a successful wizard commit. */
  insertBatch(batch: ImportBatch): Promise<void>

  /**
   * Patch the row_count + grade breakdown columns for an existing batch (B5).
   * Used after fan-out to flip the placeholder row to its real counts.
   */
  updateBatchCounts(id: string, update: ImportBatchCountUpdate): Promise<void>

  /**
   * List recent batches for a tenant, newest first. Used by the dashboard
   * "your imports" panel; bounded by `limit` (caller decides; ≤50 in MVP).
   */
  findByRestaurant(restaurantId: string, limit: number): Promise<ImportBatch[]>
}
