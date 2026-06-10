import { randomUUID } from 'crypto'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { loyaltyToken } from '@/domain/value-objects/loyalty-token'
import { insertConsentRecord } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { ConsentRecord } from '@/domain/entities/consent-record'
import {
  ConsentImportError,
  type ConsentImportReason,
} from '@/domain/repositories/consent-record-repository'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'

export interface MemberImportConsentBlock {
  source: string
  sourceReference?: string | null
  businessNameShown?: string | null
  capturedAt?: Date
  capturedIp?: string | null
  capturedUserAgent?: string | null
  grade?: ConsentGrade
}

export interface MemberImportRow {
  phoneE164: string
  name?: string | null
  preferredLanguage?: 'en' | 'zh_hk' | null
  consent: MemberImportConsentBlock
}

export interface ImportRejection {
  row: MemberImportRow
  reason: ConsentImportReason
  message?: string
}

export interface ImportResult {
  imported: number
  rejected: ImportRejection[]
}

interface ImportArgs {
  restaurantId: string
  rows: MemberImportRow[]
}

/**
 * CSV / API import boundary for new members. ALWAYS writes a consent_records
 * row alongside the member — rows missing a consent.source are rejected
 * outright. On partial failure (duplicate consent, member-insert failure)
 * the result reports the rejected rows but does not throw.
 */
export async function importMembersWithConsent(
  args: ImportArgs
): Promise<ImportResult> {
  const summary: ImportResult = { imported: 0, rejected: [] }
  for (const row of args.rows) {
    const outcome = await importOne(args.restaurantId, row)
    if (outcome.ok) summary.imported++
    else summary.rejected.push(outcome.rejection)
  }
  return summary
}

type ImportOutcome =
  | { ok: true }
  | { ok: false; rejection: ImportRejection }

async function importOne(
  restaurantId: string,
  row: MemberImportRow
): Promise<ImportOutcome> {
  if (!hasValidSource(row.consent)) {
    return reject(row, 'missing_consent_source', 'consent.source is required')
  }
  const memberId = await tryInsertMember(restaurantId, row)
  if (!memberId.ok) return reject(row, 'member_insert_failed', memberId.message)
  return tryInsertConsent(restaurantId, memberId.id, row)
}

function hasValidSource(consent: MemberImportConsentBlock): boolean {
  return typeof consent.source === 'string' && consent.source.trim().length > 0
}

async function tryInsertMember(
  restaurantId: string,
  row: MemberImportRow
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .insert({
      restaurant_id: restaurantId,
      phone: row.phoneE164,
      name: row.name ?? null,
      status: 'active',
      preferred_language: row.preferredLanguage ?? null,
      loyalty_token: loyaltyToken(),
    })
    .select('id')
    .single()
  if (error || !data) {
    return { ok: false, message: error?.message ?? 'unknown insert error' }
  }
  return { ok: true, id: (data as { id: string }).id }
}

async function tryInsertConsent(
  restaurantId: string,
  memberId: string,
  row: MemberImportRow
): Promise<ImportOutcome> {
  const record = buildConsentFromImport(row, restaurantId, memberId)
  try {
    await insertConsentRecord(record)
    return { ok: true }
  } catch (err) {
    if (err instanceof ConsentImportError) {
      return reject(row, err.reason, err.message)
    }
    return reject(
      row,
      'consent_insert_failed',
      err instanceof Error ? err.message : String(err)
    )
  }
}

function buildConsentFromImport(
  row: MemberImportRow,
  restaurantId: string,
  memberId: string
): ConsentRecord {
  return ConsentRecord.grant({
    id: randomUUID(),
    restaurantId,
    memberId,
    phoneE164: row.phoneE164,
    category: 'marketing',
    source: row.consent.source,
    sourceReference: row.consent.sourceReference ?? null,
    businessNameShown: row.consent.businessNameShown ?? null,
    grade: row.consent.grade ?? 'strong',
    capturedAt: row.consent.capturedAt,
    capturedIp: row.consent.capturedIp ?? null,
    capturedUserAgent: row.consent.capturedUserAgent ?? null,
  })
}

function reject(
  row: MemberImportRow,
  reason: ImportRejection['reason'],
  message?: string
): { ok: false; rejection: ImportRejection } {
  return { ok: false, rejection: { row, reason, message } }
}
