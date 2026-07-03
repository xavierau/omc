// WONB-004 — Stream C: commit + list endpoints for the contact import wizard.
// POST  → runs `importContactsBatch` (writes import_batch + consent_records).
// GET   → lists last 50 batches for the tenant as lightweight summaries for
//         the "your imports" panel (no aggregate JOIN, denormalised counts).

import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { importContactsBatch } from '@/application/import-contacts-batch'
import { findByRestaurant } from '@/infrastructure/supabase/repositories/import-batch-repository'
import type { ImportBatch } from '@/domain/entities/import-batch'
import {
  mapImportRouteError,
  parseConsentChannelOrThrow,
  parseDateOrThrow,
  type ImportBatchWireBody,
} from './_shared'

const LIST_LIMIT = 50

export async function POST(request: NextRequest) {
  try {
    const { restaurantId, userId } = await getTenantContext()
    const body = (await request.json()) as ImportBatchWireBody
    const result = await importContactsBatch({
      restaurantId,
      createdBy: userId,
      metadata: {
        source: body.metadata.source,
        dateRangeStart: parseDateOrThrow(
          body.metadata.dateRangeStart,
          'dateRangeStart'
        ),
        dateRangeEnd: parseDateOrThrow(
          body.metadata.dateRangeEnd,
          'dateRangeEnd'
        ),
        consentTextShown: body.metadata.consentTextShown,
        consentChannel: parseConsentChannelOrThrow(body.metadata.consentChannel),
        proofUrl: body.metadata.proofUrl,
      },
      rows: body.rows,
      mergeExistingMembers: body.mergeExistingMembers ?? false,
      tagIds: body.tags ?? [],
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return mapImportRouteError(error, 'Imports commit API error')
  }
}

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const batches = await findByRestaurant(restaurantId, LIST_LIMIT)
    return NextResponse.json({ batches: batches.map(toSummary) }, { status: 200 })
  } catch (error) {
    return mapImportRouteError(error, 'Imports list API error')
  }
}

function toSummary(batch: ImportBatch) {
  const s = batch.snapshot
  return {
    id: s.id,
    source: s.source,
    createdAt: s.createdAt,
    rowCount: s.rowCount,
    gradeBreakdown: {
      strong: s.strongCount,
      medium: s.mediumCount,
      weak: s.weakCount,
      none: s.noneCount,
    },
  }
}
