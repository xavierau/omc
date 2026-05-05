import { describe, it, expect } from 'vitest'
import { ConsentRecord } from '@/domain/entities/consent-record'
import {
  toEntity,
  toRow,
  type ConsentRecordRow,
} from '../consent-record-mapper'

const baseRow: ConsentRecordRow = {
  id: 'cr-1',
  restaurant_id: 'r-1',
  member_id: 'm-1',
  phone_e164: '85291234567',
  category: 'marketing',
  status: 'opted_in',
  consent_grade: 'strong',
  source: 'website_form',
  source_reference: null,
  business_name_shown: null,
  captured_at: '2026-05-04T10:00:00.000Z',
  revoked_at: null,
  captured_ip: null,
  captured_user_agent: null,
  proof_url: null,
  consent_text_shown: null,
  expires_at: null,
  granted_at: null,
}

describe('consent-record-mapper WONB-005 audit columns', () => {
  it('toEntity reads proof_url, consent_text_shown, expires_at', () => {
    const row: ConsentRecordRow = {
      ...baseRow,
      proof_url: 'https://supabase.test/storage/cr-1.pdf',
      consent_text_shown: 'I agree to marketing.',
      expires_at: '2028-05-04T10:00:00.000Z',
    }
    const entity = toEntity(row)
    expect(entity.snapshot.proofUrl).toBe(
      'https://supabase.test/storage/cr-1.pdf'
    )
    expect(entity.snapshot.consentTextShown).toBe('I agree to marketing.')
    expect(entity.snapshot.expiresAt).toBe('2028-05-04T10:00:00.000Z')
  })

  it('toEntity preserves null for the new audit columns', () => {
    const entity = toEntity(baseRow)
    expect(entity.snapshot.proofUrl).toBeNull()
    expect(entity.snapshot.consentTextShown).toBeNull()
    expect(entity.snapshot.expiresAt).toBeNull()
  })

  it('toRow writes proof_url, consent_text_shown, expires_at', () => {
    const record = ConsentRecord.grant({
      id: 'cr-2',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'website_form',
      proofUrl: 'https://supabase.test/storage/cr-2.pdf',
      consentTextShown: 'Verbatim consent text.',
      expiresAt: '2028-06-01T00:00:00.000Z',
    })
    const row = toRow(record)
    expect(row.proof_url).toBe('https://supabase.test/storage/cr-2.pdf')
    expect(row.consent_text_shown).toBe('Verbatim consent text.')
    expect(row.expires_at).toBe('2028-06-01T00:00:00.000Z')
  })

  it('toRow emits null for omitted audit fields (existing callers stay backward-compatible)', () => {
    const record = ConsentRecord.grant({
      id: 'cr-3',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'csv_import',
    })
    const row = toRow(record)
    expect(row.proof_url).toBeNull()
    expect(row.consent_text_shown).toBeNull()
    expect(row.expires_at).toBeNull()
  })

  it('round-trips a populated row through toEntity → toRow without loss', () => {
    const row: ConsentRecordRow = {
      ...baseRow,
      consent_grade: 'medium',
      proof_url: 'https://supabase.test/storage/cr-rt.pdf',
      consent_text_shown: 'roundtrip text',
      expires_at: '2028-12-31T23:59:59.000Z',
    }
    expect(toRow(toEntity(row))).toEqual(row)
  })

  it.each(['strong', 'medium', 'weak', 'none'] as const)(
    'round-trips consent_grade=%s through toEntity → toRow',
    (grade) => {
      const row: ConsentRecordRow = { ...baseRow, consent_grade: grade }
      const entity = toEntity(row)
      expect(entity.snapshot.consentGrade).toBe(grade)
      expect(toRow(entity).consent_grade).toBe(grade)
    }
  )

  it('round-trips granted_at (snake) ↔ grantedAt (camel)', () => {
    const row: ConsentRecordRow = {
      ...baseRow,
      granted_at: '2026-05-04T11:30:00.000Z',
    }
    const entity = toEntity(row)
    expect(entity.snapshot.grantedAt).toBe('2026-05-04T11:30:00.000Z')
    expect(toRow(entity).granted_at).toBe('2026-05-04T11:30:00.000Z')
  })

  it('preserves null granted_at on a fresh grant() (the repo stamps it on flip, not on insert)', () => {
    const record = ConsentRecord.grant({
      id: 'cr-grant-null',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'website_form',
    })
    expect(toRow(record).granted_at).toBeNull()
  })
})
