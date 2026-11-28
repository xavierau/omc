// WONB-004 — Stream C: preview endpoint. Validates metadata + grades the
// batch + classifies rows WITHOUT touching the DB. Wizard's grade-preview
// step calls this before commit so admins see breakdown before persistence.

import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { previewContactsBatch } from '@/application/preview-contacts-batch'
import {
  mapImportRouteError,
  parseConsentChannelOrThrow,
  parseDateOrThrow,
  validateWireTags,
  type ImportBatchWireBody,
} from '../_shared'

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = (await request.json()) as ImportBatchWireBody
    validateWireTags(body)
    const result = await previewContactsBatch({
      restaurantId,
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
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return mapImportRouteError(error, 'Imports preview API error')
  }
}
