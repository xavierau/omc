// WONB-004: per-row inserter for the contact import wizard.
// Order: resolve memberId (member helper) → insert consent_record → emit event.
// Errors are returned (not thrown) so the orchestrator can keep going on
// per-row failures and surface them in the result's `rejected[]`.

import { randomUUID } from 'crypto'
import { insertConsentRecord } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { ConsentImportError } from '@/domain/repositories/consent-record-repository'
import { ConsentRecord } from '@/domain/entities/consent-record'
import { emitEvent } from '@/application/emit-event'
import { resolveMemberId } from './import-contacts-batch-row-member'
import type { ConsentChannel } from '@/domain/value-objects/consent-channel'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'
import type { ImportRowRejectReason } from '@/domain/services/__errors__/import-errors'

export interface ImportOneRowMeta {
  source: string
  consentChannel: ConsentChannel
  consentTextShown: string
  proofUrl: string | null
  importBatchId: string
  capturedAt: Date
}

export interface ImportOneRowInput {
  restaurantId: string
  mergeExistingMembers: boolean
  grade: ConsentGrade
  meta: ImportOneRowMeta
  row: { phoneE164: string; name: string | null; preferredLanguage: 'en' | 'zh_hk' | null }
}

export type ImportRowOutcome =
  | { ok: true; gradeBucket: ConsentGrade; created: boolean }
  | { ok: false; reject: { phoneE164: string; reason: ImportRowRejectReason; message?: string } }

export async function importOneContactRow(
  input: ImportOneRowInput
): Promise<ImportRowOutcome> {
  const member = await resolveMemberId({
    restaurantId: input.restaurantId,
    mergeExistingMembers: input.mergeExistingMembers,
    row: input.row,
  })
  if (!member.ok) return { ok: false, reject: member.reject }
  return persistConsentAndEvent(input, member.id, member.created)
}

async function persistConsentAndEvent(
  input: ImportOneRowInput,
  memberId: string | null,
  created: boolean
): Promise<ImportRowOutcome> {
  const record = ConsentRecord.grant({
    id: randomUUID(),
    restaurantId: input.restaurantId,
    memberId,
    phoneE164: input.row.phoneE164,
    category: 'marketing',
    source: input.meta.source,
    grade: input.grade,
    capturedAt: input.meta.capturedAt,
    proofUrl: input.meta.proofUrl,
    consentTextShown: input.meta.consentTextShown,
    importBatchId: input.meta.importBatchId,
  })
  try {
    await insertConsentRecord(record)
  } catch (err) {
    return rejectFromConsentError(input.row.phoneE164, err)
  }
  await emitEvent({
    restaurantId: input.restaurantId,
    memberId,
    type: 'consent_imported',
    dataJson: {
      importBatchId: input.meta.importBatchId,
      grade: input.grade,
      channel: input.meta.consentChannel,
      source: input.meta.source,
    },
  })
  return { ok: true, gradeBucket: input.grade, created }
}

function rejectFromConsentError(phoneE164: string, err: unknown): ImportRowOutcome {
  const reason: ImportRowRejectReason =
    err instanceof ConsentImportError
      ? (err.reason as ImportRowRejectReason)
      : 'duplicate_active'
  const message = err instanceof Error ? err.message : String(err)
  return { ok: false, reject: { phoneE164, reason, message } }
}
