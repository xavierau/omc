// WONB-004: snake-case row <-> ImportBatch domain entity for migration 048.

import { ImportBatch, type ImportBatchProps } from '@/domain/entities/import-batch'
import type { ConsentChannel } from '@/domain/value-objects/consent-channel'

export interface ImportBatchRow {
  id: string
  restaurant_id: string
  source: string
  date_range_start: string
  date_range_end: string
  consent_text_shown: string
  consent_channel: ConsentChannel
  proof_url: string | null
  row_count: number
  strong_count: number
  medium_count: number
  weak_count: number
  none_count: number
  created_by: string | null
  created_at: string
}

export function toEntity(row: ImportBatchRow): ImportBatch {
  const props: ImportBatchProps = {
    id: row.id,
    restaurantId: row.restaurant_id,
    source: row.source,
    dateRangeStart: row.date_range_start,
    dateRangeEnd: row.date_range_end,
    consentTextShown: row.consent_text_shown,
    consentChannel: row.consent_channel,
    proofUrl: row.proof_url,
    rowCount: row.row_count,
    strongCount: row.strong_count,
    mediumCount: row.medium_count,
    weakCount: row.weak_count,
    noneCount: row.none_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
  return ImportBatch.fromProps(props)
}

export function toInsertRow(e: ImportBatch): ImportBatchRow {
  const s = e.snapshot
  return {
    id: s.id,
    restaurant_id: s.restaurantId,
    source: s.source,
    date_range_start: s.dateRangeStart,
    date_range_end: s.dateRangeEnd,
    consent_text_shown: s.consentTextShown,
    consent_channel: s.consentChannel,
    proof_url: s.proofUrl,
    row_count: s.rowCount,
    strong_count: s.strongCount,
    medium_count: s.mediumCount,
    weak_count: s.weakCount,
    none_count: s.noneCount,
    created_by: s.createdBy,
    created_at: s.createdAt,
  }
}
