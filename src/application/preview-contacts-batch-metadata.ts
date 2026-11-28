import { ImportBatch } from '@/domain/entities/import-batch'
import type { PreviewBatchMetadata } from './preview-contacts-batch'

/**
 * Extracted from preview-contacts-batch.ts (TAG-001 B5) — that file was
 * already at the 150-line cap after B1, and the plan's ≤8-line delta budget
 * for the `lookups` addition required moving something out (the sanctioned
 * escape hatch). Pure re-validation of ImportBatch invariants against
 * zeroed row counts; no behaviour change from the original inline function.
 */
export function validateMetadata(
  restaurantId: string,
  metadata: PreviewBatchMetadata,
  now: Date
): void {
  ImportBatch.create({
    id: '00000000-0000-0000-0000-000000000000',
    restaurantId,
    source: metadata.source,
    dateRangeStart: metadata.dateRangeStart,
    dateRangeEnd: metadata.dateRangeEnd,
    consentTextShown: metadata.consentTextShown,
    consentChannel: metadata.consentChannel,
    proofUrl: metadata.proofUrl,
    rowCount: 0,
    strongCount: 0,
    mediumCount: 0,
    weakCount: 0,
    noneCount: 0,
    createdBy: null,
    now,
  })
}
