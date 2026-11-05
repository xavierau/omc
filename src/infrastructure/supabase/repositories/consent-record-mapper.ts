import {
  ConsentRecord,
  type ConsentRecordProps,
} from '@/domain/entities/consent-record'
import type {
  ConsentCategory,
  ConsentGrade,
  ConsentStatus,
} from '@/domain/value-objects/consent-status'

export interface ConsentRecordRow {
  id: string
  restaurant_id: string
  member_id: string | null
  phone_e164: string
  category: ConsentCategory
  status: ConsentStatus
  consent_grade: ConsentGrade
  source: string
  source_reference: string | null
  business_name_shown: string | null
  captured_at: string
  revoked_at: string | null
  captured_ip: string | null
  captured_user_agent: string | null
  proof_url: string | null
  consent_text_shown: string | null
  expires_at: string | null
  granted_at: string | null
  import_batch_id: string | null
}

export function toEntity(row: ConsentRecordRow): ConsentRecord {
  const props: ConsentRecordProps = {
    id: row.id,
    restaurantId: row.restaurant_id,
    memberId: row.member_id,
    phoneE164: row.phone_e164,
    category: row.category,
    status: row.status,
    consentGrade: row.consent_grade,
    source: row.source,
    sourceReference: row.source_reference,
    businessNameShown: row.business_name_shown,
    capturedAt: row.captured_at,
    revokedAt: row.revoked_at,
    capturedIp: row.captured_ip,
    capturedUserAgent: row.captured_user_agent,
    proofUrl: row.proof_url,
    consentTextShown: row.consent_text_shown,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
    importBatchId: row.import_batch_id,
  }
  return ConsentRecord.fromProps(props)
}

export function toRow(record: ConsentRecord): ConsentRecordRow {
  const s = record.snapshot
  return {
    id: s.id,
    restaurant_id: s.restaurantId,
    member_id: s.memberId,
    phone_e164: s.phoneE164,
    category: s.category,
    status: s.status,
    consent_grade: s.consentGrade,
    source: s.source,
    source_reference: s.sourceReference,
    business_name_shown: s.businessNameShown,
    captured_at: s.capturedAt,
    revoked_at: s.revokedAt,
    captured_ip: s.capturedIp,
    captured_user_agent: s.capturedUserAgent,
    proof_url: s.proofUrl,
    consent_text_shown: s.consentTextShown,
    expires_at: s.expiresAt,
    granted_at: s.grantedAt,
    import_batch_id: s.importBatchId,
  }
}
