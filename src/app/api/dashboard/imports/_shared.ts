// WONB-004 — Stream C: shared error-mapping for the import routes.
// Mirrors the WONB-001 onboarding _shared pattern. AuthError surfaces from
// the tenant guard with its own status; ImportBatchValidationError → 400;
// anything else → 500 with a generic message (no internals leaked).

import { NextResponse } from 'next/server'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { ImportBatchValidationError } from '@/domain/services/__errors__/import-errors'
import { CrossTenantTagError } from '@/infrastructure/supabase/repositories/member-tag-repository'
import { isUuidArray } from '@/infrastructure/validation/validators'
import {
  isConsentChannel,
  type ConsentChannel,
} from '@/domain/value-objects/consent-channel'

export function mapImportRouteError(
  error: unknown,
  logLabel: string
): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  if (error instanceof ImportBatchValidationError) {
    return NextResponse.json(
      { error: error.message, reason: error.reason },
      { status: 400 }
    )
  }
  // A batch-level tag id that belongs to another tenant is an authorization
  // rejection (403), raised before any write — same contract as the member
  // tag routes (review M-7).
  if (error instanceof CrossTenantTagError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  console.error(`${logLabel}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function readJsonBody<T>(
  request: Request
): Promise<T> {
  return (await request.json()) as T
}

interface MetadataWire {
  source: string
  dateRangeStart: string
  dateRangeEnd: string
  consentTextShown: string
  consentChannel: string
  proofUrl: string | null
}

export interface ImportBatchWireBody {
  metadata: MetadataWire
  rows: Array<{
    phoneE164: string
    name?: string | null
    preferredLanguage?: 'en' | 'zh_hk' | null
    // TAG-001 B1: per-row tag NAMES parsed from the CSV `tags`/`tag` column
    // (AD-1). Distinct from the batch-level `tags` below, which is IDS.
    tags?: string[]
  }>
  mergeExistingMembers?: boolean
  // TAG-001: tags selected in the wizard, applied to every member in the batch.
  tags?: string[]
}

/**
 * Wire-shape guard for the two DIFFERENT `tags` fields on an import body:
 * per-row `tags` are NAMES (free text lifted from the CSV), batch-level `tags`
 * are tag IDS picked in the wizard. Neither is validated downstream, so a
 * non-array reaches the domain normaliser and a non-UUID id reaches PostgREST
 * — both surfacing as a 500 for what is bad client input (round 2, finding 6).
 */
export function validateWireTags(body: ImportBatchWireBody): void {
  if (body.tags !== undefined && !isUuidArray(body.tags)) {
    throw new ImportBatchValidationError(
      'invalid_tags',
      'tags must be an array of tag UUIDs'
    )
  }
  const rows = Array.isArray(body.rows) ? body.rows : []
  for (const row of rows) {
    if (row?.tags !== undefined && !isStringArray(row.tags)) {
      throw new ImportBatchValidationError(
        'invalid_tags',
        'each row `tags` must be an array of strings'
      )
    }
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

export function parseDateOrThrow(value: string, field: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new ImportBatchValidationError(
      'invalid_date_range',
      `${field} is not a valid date`
    )
  }
  return date
}

// B4: runtime validation of the wire-level consent channel string. Routes
// must call this BEFORE the use case so a bogus channel never reaches the
// orchestrator (which would otherwise fall through gradeConsent's defaults
// and orphan rows when the DB CHECK rejects them).
export function parseConsentChannelOrThrow(value: string): ConsentChannel {
  if (!isConsentChannel(value)) {
    throw new ImportBatchValidationError(
      'invalid_consent_channel',
      `consentChannel '${value}' is not a recognised channel`
    )
  }
  return value
}
