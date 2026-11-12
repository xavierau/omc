import { describe, it, expect } from 'vitest'
import { validateMetadata } from '../preview-contacts-batch-metadata'
import type { PreviewBatchMetadata } from '../preview-contacts-batch'

const NOW = new Date('2026-05-04T12:00:00.000Z')

function validMetadata(overrides: Partial<PreviewBatchMetadata> = {}): PreviewBatchMetadata {
  return {
    source: 'paper-list-2026-Q1',
    dateRangeStart: new Date('2025-11-01T00:00:00.000Z'),
    dateRangeEnd: new Date('2026-01-31T00:00:00.000Z'),
    consentTextShown: 'I agree to receive WhatsApp marketing.',
    consentChannel: 'whatsapp',
    proofUrl: 'rest-1/proof.jpg',
    ...overrides,
  }
}

describe('validateMetadata (extracted from preview-contacts-batch.ts, B5)', () => {
  it('does not throw for valid metadata', () => {
    expect(() => validateMetadata('rest-1', validMetadata(), NOW)).not.toThrow()
  })

  it('throws ImportBatchValidationError(whatsapp_proof_required) when the whatsapp channel has no proof', () => {
    expect(() =>
      validateMetadata('rest-1', validMetadata({ proofUrl: null }), NOW)
    ).toThrow(/whatsapp_proof_required/)
  })

  it('throws ImportBatchValidationError(empty_source) for a blank source', () => {
    expect(() =>
      validateMetadata('rest-1', validMetadata({ source: '  ' }), NOW)
    ).toThrow(/empty_source/)
  })
})
