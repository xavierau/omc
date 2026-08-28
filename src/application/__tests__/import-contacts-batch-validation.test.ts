import { describe, it, expect } from 'vitest'
import {
  validatePreflight,
  type PreflightInput,
} from '../import-contacts-batch-validation'

const NOW = new Date('2026-05-04T12:00:00.000Z')

function buildInput(
  rows: Array<{ phoneE164: string; name?: string | null; tags?: string[] }>
): PreflightInput {
  return {
    metadata: {
      source: 'paper-list-2026-Q1',
      dateRangeStart: new Date('2025-11-01T00:00:00.000Z'),
      dateRangeEnd: new Date('2026-01-31T00:00:00.000Z'),
      consentTextShown: 'I agree to receive marketing messages from Demo Cafe.',
      consentChannel: 'generic',
      proofUrl: null,
    },
    rows,
    now: NOW,
  }
}

describe('validatePreflight — metadata', () => {
  it('passes through valid metadata', () => {
    const result = validatePreflight(buildInput([{ phoneE164: '85291234567' }]))
    expect(result.metadataError).toBeNull()
  })

  it('catches missing whatsapp proof at the metadata layer', () => {
    const input = buildInput([{ phoneE164: '85291234567' }])
    input.metadata.consentChannel = 'whatsapp'
    input.metadata.proofUrl = null
    const result = validatePreflight(input)
    expect(result.metadataError?.reason).toBe('whatsapp_proof_required')
  })
})

describe('validatePreflight — per-row', () => {
  it('rejects rows with invalid phone formats', () => {
    const result = validatePreflight(
      buildInput([
        { phoneE164: '85291234567' },
        { phoneE164: '123' },                  // too short
        { phoneE164: 'not-a-phone' },
      ])
    )
    expect(result.metadataError).toBeNull()
    expect(result.rejected).toHaveLength(2)
    expect(result.rejected.every((r) => r.reason === 'invalid_phone')).toBe(true)
    expect(result.acceptedRows).toHaveLength(1)
  })

  it('detects duplicate phones within batch (case-normalised)', () => {
    const result = validatePreflight(
      buildInput([
        { phoneE164: '85291234567' },
        { phoneE164: '+85291234567' },         // same after normalisation
        { phoneE164: '85299999999' },
      ])
    )
    const dups = result.rejected.filter(
      (r) => r.reason === 'duplicate_phone_in_batch'
    )
    expect(dups).toHaveLength(1)
    expect(result.acceptedRows).toHaveLength(2)
  })

  it('returns normalised phone on accepted rows', () => {
    const result = validatePreflight(
      buildInput([{ phoneE164: '852-9123 4567' }])
    )
    expect(result.acceptedRows[0].phoneE164).toBe('+85291234567')
  })

  it('rejects empty row list at metadata layer? No — leaves orchestrator to decide', () => {
    const result = validatePreflight(buildInput([]))
    expect(result.metadataError).toBeNull()
    expect(result.acceptedRows).toEqual([])
    expect(result.rejected).toEqual([])
  })
})

describe('validatePreflight — tags (TAG-001 B1)', () => {
  it('populates acceptedRows[].tags from row.tags', () => {
    const result = validatePreflight(
      buildInput([{ phoneE164: '85291234567', tags: ['vip', 'lunch'] }])
    )
    expect(result.acceptedRows[0].tags).toEqual(['vip', 'lunch'])
  })

  it('defaults to an empty array when the row carries no tags', () => {
    const result = validatePreflight(buildInput([{ phoneE164: '85291234567' }]))
    expect(result.acceptedRows[0].tags).toEqual([])
  })

  it('re-normalises server-side: never trusts client casing/whitespace/dupes (T-B1.12)', () => {
    const result = validatePreflight(
      buildInput([
        { phoneE164: '85291234567', tags: ['  VIP  ', 'vip', ''] },
      ])
    )
    expect(result.acceptedRows[0].tags).toEqual(['VIP'])
  })

  it('does not attach tags to a rejected row', () => {
    const result = validatePreflight(
      buildInput([{ phoneE164: 'not-a-phone', tags: ['vip'] }])
    )
    expect(result.acceptedRows).toEqual([])
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]).not.toHaveProperty('tags')
  })
})
