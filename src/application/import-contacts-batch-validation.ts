// WONB-004: pure pre-flight checks (metadata + rows) for the contact import
// wizard. Run before any DB writes so the orchestrator can short-circuit on
// metadata errors and surface row rejections in the result.

import { PhoneNumber } from '@/domain/value-objects/phone-number'
import type { ConsentChannel } from '@/domain/value-objects/consent-channel'
import {
  ImportBatchValidationError,
  type ImportBatchValidationReason,
  type ImportRowRejectReason,
} from '@/domain/services/__errors__/import-errors'
import { normalizeImportTagNames } from '@/domain/services/normalize-import-tags'

export interface PreflightMetadata {
  source: string
  dateRangeStart: Date
  dateRangeEnd: Date
  consentTextShown: string
  consentChannel: ConsentChannel
  proofUrl: string | null
}

export interface PreflightRowInput {
  phoneE164: string
  name?: string | null
  preferredLanguage?: 'en' | 'zh_hk' | null
  // TAG-001 B1: per-row tag NAMES from the CSV (AD-1). Re-normalised below —
  // never trusted as-is from the client.
  tags?: string[]
}

export interface PreflightInput {
  metadata: PreflightMetadata
  rows: PreflightRowInput[]
  now?: Date
}

export interface PreflightAcceptedRow {
  phoneE164: string                  // normalised E.164 with leading +
  rawPhone: string
  name: string | null
  preferredLanguage: 'en' | 'zh_hk' | null
  tags: string[]                     // normalised names, never ids
}

export interface PreflightReject {
  phoneE164: string                  // raw input, not normalised
  reason: ImportRowRejectReason
  message?: string
}

export interface PreflightResult {
  metadataError: { reason: ImportBatchValidationReason; message: string } | null
  acceptedRows: PreflightAcceptedRow[]
  rejected: PreflightReject[]
}

export function validatePreflight(input: PreflightInput): PreflightResult {
  const metadataError = checkMetadata(input.metadata, input.now ?? new Date())
  if (metadataError) {
    return { metadataError, acceptedRows: [], rejected: [] }
  }
  return classifyRows(input.rows)
}

function checkMetadata(
  m: PreflightMetadata,
  now: Date
): PreflightResult['metadataError'] {
  try {
    if (!m.source.trim()) throw new ImportBatchValidationError('empty_source')
    if (m.consentTextShown.trim().length < 10) {
      throw new ImportBatchValidationError('short_consent_text')
    }
    if (m.dateRangeEnd.getTime() < m.dateRangeStart.getTime()) {
      throw new ImportBatchValidationError('invalid_date_range')
    }
    if (m.dateRangeEnd.getTime() > now.getTime()) {
      throw new ImportBatchValidationError('future_date_range')
    }
    if (m.consentChannel === 'whatsapp' && !m.proofUrl) {
      throw new ImportBatchValidationError('whatsapp_proof_required')
    }
    return null
  } catch (err) {
    if (err instanceof ImportBatchValidationError) {
      return { reason: err.reason, message: err.message }
    }
    throw err
  }
}

function classifyRows(rows: PreflightRowInput[]): PreflightResult {
  const seen = new Set<string>()
  const acceptedRows: PreflightAcceptedRow[] = []
  const rejected: PreflightReject[] = []
  for (const row of rows) {
    const normalized = tryNormalize(row.phoneE164)
    if (!normalized) {
      rejected.push({ phoneE164: row.phoneE164, reason: 'invalid_phone' })
      continue
    }
    if (seen.has(normalized)) {
      rejected.push({ phoneE164: row.phoneE164, reason: 'duplicate_phone_in_batch' })
      continue
    }
    seen.add(normalized)
    acceptedRows.push({
      phoneE164: normalized,
      rawPhone: row.phoneE164,
      name: row.name ?? null,
      preferredLanguage: row.preferredLanguage ?? null,
      tags: normalizeImportTagNames(row.tags ?? []).names,
    })
  }
  return { metadataError: null, acceptedRows, rejected }
}

function tryNormalize(raw: string): string | null {
  try {
    return PhoneNumber.create(raw).value
  } catch {
    return null
  }
}
