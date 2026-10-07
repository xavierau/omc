import { describe, it, expect } from 'vitest'
import {
  validateBatchMeta,
  type BatchMetaInput,
  type BatchMetaError,
} from '@/components/dashboard/import-wizard/step-batch-meta-helpers'

const today = '2026-05-05'
const yesterday = '2026-05-04'
const tomorrow = '2026-05-06'

const validInput: BatchMetaInput = {
  source: 'Reservation notebook 2025',
  dateRangeStart: '2025-01-01',
  dateRangeEnd: yesterday,
  consentTextShown: 'We will send offers on WhatsApp.',
  consentChannel: 'whatsapp',
  proofFilePresent: true,
  tagIds: [],
}

describe('validateBatchMeta', () => {
  it('returns no errors for a valid whatsapp batch', () => {
    expect(validateBatchMeta(validInput, today)).toEqual([])
  })

  it('rejects empty source', () => {
    const errs: BatchMetaError[] = validateBatchMeta(
      { ...validInput, source: '   ' },
      today
    )
    expect(errs).toContain('source_required')
  })

  it('rejects consent text shorter than 10 chars', () => {
    expect(validateBatchMeta({ ...validInput, consentTextShown: 'short' }, today)).toContain(
      'consent_text_too_short'
    )
  })

  it('rejects when dateRangeEnd before dateRangeStart', () => {
    expect(
      validateBatchMeta(
        { ...validInput, dateRangeStart: '2025-06-01', dateRangeEnd: '2025-01-01' },
        today
      )
    ).toContain('date_range_invalid')
  })

  it('rejects when dateRangeEnd is in the future', () => {
    expect(validateBatchMeta({ ...validInput, dateRangeEnd: tomorrow }, today)).toContain(
      'date_range_future'
    )
  })

  it('rejects whatsapp channel without proof file', () => {
    expect(
      validateBatchMeta({ ...validInput, proofFilePresent: false }, today)
    ).toContain('proof_required_for_whatsapp')
  })

  it('allows generic channel without proof file', () => {
    expect(
      validateBatchMeta(
        {
          ...validInput,
          consentChannel: 'generic',
          proofFilePresent: false,
        },
        today
      )
    ).toEqual([])
  })

  it('rejects missing date fields', () => {
    expect(
      validateBatchMeta({ ...validInput, dateRangeStart: '' }, today)
    ).toContain('date_range_invalid')
    expect(
      validateBatchMeta({ ...validInput, dateRangeEnd: '' }, today)
    ).toContain('date_range_invalid')
  })
})
