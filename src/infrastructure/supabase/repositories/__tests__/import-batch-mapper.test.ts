import { describe, it, expect } from 'vitest'
import { ImportBatch } from '@/domain/entities/import-batch'
import { toEntity, toInsertRow, type ImportBatchRow } from '../import-batch-mapper'

const NOW = new Date('2026-05-04T12:00:00.000Z')

describe('import-batch-mapper', () => {
  it('toInsertRow round-trips a fresh entity to snake_case columns', () => {
    const e = ImportBatch.create({
      id: '11111111-1111-1111-1111-111111111111',
      restaurantId: 'rest-1',
      source: 'paper-list-2026-Q1',
      dateRangeStart: new Date('2025-11-01T00:00:00.000Z'),
      dateRangeEnd: new Date('2026-01-31T00:00:00.000Z'),
      consentTextShown: 'I agree to receive marketing messages from Demo Cafe.',
      consentChannel: 'generic',
      proofUrl: null,
      rowCount: 50,
      strongCount: 0,
      mediumCount: 30,
      weakCount: 20,
      noneCount: 0,
      createdBy: 'auth-1',
      now: NOW,
    })
    const row = toInsertRow(e)
    expect(row).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      restaurant_id: 'rest-1',
      source: 'paper-list-2026-Q1',
      consent_channel: 'generic',
      proof_url: null,
      row_count: 50,
      strong_count: 0,
      medium_count: 30,
      weak_count: 20,
      none_count: 0,
      created_by: 'auth-1',
    })
    expect(row.created_at).toBe(NOW.toISOString())
  })

  it('toEntity hydrates a domain entity from a snake_case row', () => {
    const row: ImportBatchRow = {
      id: '22222222-2222-2222-2222-222222222222',
      restaurant_id: 'rest-2',
      source: 'whatsapp-bulk-2026-04',
      date_range_start: '2025-11-01T00:00:00.000Z',
      date_range_end: '2026-04-30T00:00:00.000Z',
      consent_text_shown: 'I agree to receive marketing messages from Demo.',
      consent_channel: 'whatsapp',
      proof_url: 'https://supabase.test/proof.pdf',
      row_count: 12,
      strong_count: 5,
      medium_count: 5,
      weak_count: 2,
      none_count: 0,
      created_by: 'auth-2',
      created_at: '2026-05-04T12:00:00.000Z',
    }
    const e = toEntity(row)
    expect(e.snapshot.id).toBe(row.id)
    expect(e.snapshot.consentChannel).toBe('whatsapp')
    expect(e.snapshot.proofUrl).toBe('https://supabase.test/proof.pdf')
    expect(e.snapshot.rowCount).toBe(12)
    expect(e.snapshot.strongCount).toBe(5)
  })
})
