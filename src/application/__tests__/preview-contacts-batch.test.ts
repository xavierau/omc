import { describe, it, expect } from 'vitest'
import {
  previewContactsBatch,
  type PreviewContactsBatchInput,
} from '../preview-contacts-batch'

const NOW = new Date('2026-05-04T12:00:00.000Z')

function buildInput(
  overrides: Partial<PreviewContactsBatchInput> = {}
): PreviewContactsBatchInput {
  return {
    restaurantId: 'rest-1',
    metadata: {
      source: 'paper-list-2026-Q1',
      dateRangeStart: new Date('2025-11-01T00:00:00.000Z'),
      dateRangeEnd: new Date('2026-01-31T00:00:00.000Z'),
      consentTextShown: 'I agree to receive WhatsApp marketing from Demo Cafe.',
      consentChannel: 'whatsapp',
      proofUrl: 'rest-1/proof.jpg',
    },
    rows: [
      { phoneE164: '+85291234567', name: 'Alice' },
      { phoneE164: '+85299999999', name: null },
    ],
    now: NOW,
    ...overrides,
  }
}

describe('previewContactsBatch', () => {
  it('returns batch grade and per-row grade for valid metadata + rows', async () => {
    const result = await previewContactsBatch(buildInput())
    expect(result.batchGrade).toBe('strong')
    expect(result.rows).toHaveLength(2)
    expect(result.rows.every((r) => r.grade === 'strong')).toBe(true)
    expect(result.gradeBreakdown).toEqual({
      strong: 2,
      medium: 0,
      weak: 0,
      none: 0,
    })
    expect(result.rejected).toEqual([])
  })

  it('throws ImportBatchValidationError when metadata invalid', async () => {
    const input = buildInput()
    input.metadata.consentChannel = 'whatsapp'
    input.metadata.proofUrl = null
    await expect(previewContactsBatch(input)).rejects.toThrow(
      /whatsapp_proof_required/
    )
  })

  it('rejects invalid phone numbers without aborting', async () => {
    const result = await previewContactsBatch(
      buildInput({
        rows: [
          { phoneE164: '+85291234567' },
          { phoneE164: 'not-a-phone' },
        ],
      })
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toBe('invalid_phone')
    expect(result.rejected[0].phoneE164).toBe('not-a-phone')
  })

  it('rejects in-batch duplicates (case/normalisation aware)', async () => {
    const result = await previewContactsBatch(
      buildInput({
        rows: [
          { phoneE164: '+85291234567' },
          { phoneE164: '85291234567' }, // duplicate after normalisation
          { phoneE164: '+85299999999' },
        ],
      })
    )
    expect(result.rows).toHaveLength(2)
    const dupRejects = result.rejected.filter(
      (r) => r.reason === 'duplicate_phone_in_batch'
    )
    expect(dupRejects).toHaveLength(1)
  })

  it('grades whatsapp channel + 24-month-old + WA-mention as medium', async () => {
    const input = buildInput({
      metadata: {
        source: 's',
        dateRangeStart: new Date('2024-01-01T00:00:00.000Z'),
        dateRangeEnd: new Date('2024-09-01T00:00:00.000Z'),
        consentTextShown: 'I agree to WhatsApp marketing messages.',
        consentChannel: 'whatsapp',
        proofUrl: 'rest-1/proof.jpg',
      },
      now: NOW,
    })
    const result = await previewContactsBatch(input)
    expect(result.batchGrade).toBe('medium')
    expect(result.gradeBreakdown.medium).toBe(2)
  })

  it('grades service_only channel as weak', async () => {
    const input = buildInput({
      metadata: {
        source: 's',
        dateRangeStart: new Date('2025-11-01T00:00:00.000Z'),
        dateRangeEnd: new Date('2026-01-31T00:00:00.000Z'),
        consentTextShown: 'Service messages only — utility templates.',
        consentChannel: 'service_only',
        proofUrl: null,
      },
      now: NOW,
    })
    const result = await previewContactsBatch(input)
    expect(result.batchGrade).toBe('weak')
    expect(result.gradeBreakdown.weak).toBe(2)
  })

  it('grades none channel as none', async () => {
    const input = buildInput({
      metadata: {
        source: 's',
        dateRangeStart: new Date('2025-11-01T00:00:00.000Z'),
        dateRangeEnd: new Date('2026-01-31T00:00:00.000Z'),
        consentTextShown: 'No marketing consent provided here.',
        consentChannel: 'none',
        proofUrl: null,
      },
      now: NOW,
    })
    const result = await previewContactsBatch(input)
    expect(result.batchGrade).toBe('none')
    expect(result.gradeBreakdown.none).toBe(2)
  })

  it('rejects empty rows[] with empty_rows reason (B2 — AC #5)', async () => {
    const input = buildInput({ rows: [] })
    await expect(previewContactsBatch(input)).rejects.toMatchObject({
      name: 'ImportBatchValidationError',
      reason: 'empty_rows',
    })
  })

  it('keeps row order from input', async () => {
    const result = await previewContactsBatch(
      buildInput({
        rows: [
          { phoneE164: '+85291111111', name: 'A' },
          { phoneE164: '+85292222222', name: 'B' },
          { phoneE164: '+85293333333', name: 'C' },
        ],
      })
    )
    expect(result.rows.map((r) => r.name)).toEqual(['A', 'B', 'C'])
  })
})
