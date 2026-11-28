// WONB-004: ImportBatch entity validates per-batch metadata at construction
// time. Mirrors the AC #1 rules from docs/tasks/wonb-004-plan.md verbatim.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ImportBatch, type CreateImportBatchInput } from '../import-batch'
import { ImportBatchValidationError } from '@/domain/services/__errors__/import-errors'

const NOW = new Date('2026-05-04T12:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

function buildInput(
  overrides: Partial<CreateImportBatchInput> = {}
): CreateImportBatchInput {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    restaurantId: 'rest-1',
    source: 'paper-list-2026-Q1',
    dateRangeStart: new Date('2025-11-01T00:00:00.000Z'),
    dateRangeEnd: new Date('2026-01-31T00:00:00.000Z'),
    consentTextShown: 'I agree to receive marketing messages from Demo Cafe.',
    consentChannel: 'generic',
    proofUrl: null,
    rowCount: 100,
    strongCount: 0,
    mediumCount: 50,
    weakCount: 50,
    noneCount: 0,
    createdBy: 'auth-user-1',
    now: NOW,
    ...overrides,
  }
}

describe('ImportBatch.create — happy path', () => {
  it('builds an entity exposing the snake-friendly snapshot', () => {
    const e = ImportBatch.create(buildInput())
    expect(e.snapshot).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      restaurantId: 'rest-1',
      source: 'paper-list-2026-Q1',
      consentChannel: 'generic',
      proofUrl: null,
      rowCount: 100,
      mediumCount: 50,
      weakCount: 50,
      createdBy: 'auth-user-1',
    })
    expect(e.snapshot.createdAt).toBe(NOW.toISOString())
  })

  it('accepts whatsapp channel when proofUrl provided', () => {
    const e = ImportBatch.create(
      buildInput({
        consentChannel: 'whatsapp',
        proofUrl: 'https://supabase.test/proof.pdf',
      })
    )
    expect(e.snapshot.consentChannel).toBe('whatsapp')
    expect(e.snapshot.proofUrl).toBe('https://supabase.test/proof.pdf')
  })
})

describe('ImportBatch.create — validation', () => {
  it('rejects empty source', () => {
    expect(() => ImportBatch.create(buildInput({ source: '' }))).toThrow(
      ImportBatchValidationError
    )
    expect(() => ImportBatch.create(buildInput({ source: '   ' }))).toThrow(
      /empty_source/
    )
  })

  it('rejects consent_text_shown shorter than 10 chars', () => {
    expect(() =>
      ImportBatch.create(buildInput({ consentTextShown: 'too short' }))
    ).toThrow(/short_consent_text/)
  })

  it('rejects future date_range_end (>= today + 1 day)', () => {
    const future = new Date(NOW)
    future.setUTCDate(future.getUTCDate() + 1)
    expect(() =>
      ImportBatch.create(buildInput({ dateRangeEnd: future }))
    ).toThrow(/future_date_range/)
  })

  it('rejects invalid date order (end < start)', () => {
    expect(() =>
      ImportBatch.create(
        buildInput({
          dateRangeStart: new Date('2026-02-01T00:00:00.000Z'),
          dateRangeEnd: new Date('2026-01-01T00:00:00.000Z'),
        })
      )
    ).toThrow(/invalid_date_range/)
  })

  it('rejects whatsapp channel without proofUrl (DB CHECK mirrored at entity)', () => {
    expect(() =>
      ImportBatch.create(
        buildInput({ consentChannel: 'whatsapp', proofUrl: null })
      )
    ).toThrow(/whatsapp_proof_required/)
  })

  it('rejects bogus consentChannel with reason=invalid_consent_channel (B4 defence-in-depth)', () => {
    expect(() =>
      ImportBatch.create(
        // @ts-expect-error — intentional bogus runtime value to exercise guard
        buildInput({ consentChannel: 'bogus', proofUrl: null })
      )
    ).toThrow(/invalid_consent_channel/)
  })

  it('accepts service_only / generic / none channels with proofUrl=null', () => {
    for (const channel of ['service_only', 'generic', 'none'] as const) {
      const e = ImportBatch.create(
        buildInput({ consentChannel: channel, proofUrl: null })
      )
      expect(e.snapshot.consentChannel).toBe(channel)
    }
  })
})
