import { describe, it, expect } from 'vitest'
import { buildPreviewWarnings } from '../preview-warning-helpers'
import type { PreviewLookups } from '@/hooks/use-import-batch'

const rows = (phones: string[]) => phones.map((phoneE164) => ({ phoneE164 }))

function lookups(alreadyMemberPhones: string[], activeConsentPhones: string[]): PreviewLookups {
  return { alreadyMemberPhones, activeConsentPhones, status: 'ok' }
}

describe('buildPreviewWarnings — merge OFF (AM-4 precedence)', () => {
  it('T-F1.3: a phone in alreadyMemberPhones only counts into willSkipAlreadyMember', () => {
    const result = buildPreviewWarnings({
      rows: rows(['+85291111111']),
      lookups: lookups(['+85291111111'], []),
      merge: false,
    })
    expect(result.willSkipAlreadyMember).toBe(1)
    expect(result.willMerge).toBe(0)
    expect(result.willSkipActiveConsent).toBe(0)
    expect(result.warnedPhones.has('+85291111111')).toBe(true)
  })

  it('a phone in activeConsentPhones only counts into willSkipActiveConsent', () => {
    const result = buildPreviewWarnings({
      rows: rows(['+85292222222']),
      lookups: lookups([], ['+85292222222']),
      merge: false,
    })
    expect(result.willSkipActiveConsent).toBe(1)
    expect(result.willSkipAlreadyMember).toBe(0)
    expect(result.willMerge).toBe(0)
  })

  it('T-F1.6: a phone in BOTH sets counts as already-member-skip, never merged or active-consent', () => {
    const result = buildPreviewWarnings({
      rows: rows(['+85293333333']),
      lookups: lookups(['+85293333333'], ['+85293333333']),
      merge: false,
    })
    expect(result.willSkipAlreadyMember).toBe(1)
    expect(result.willSkipActiveConsent).toBe(0)
    expect(result.willMerge).toBe(0)
    expect(result.warnedPhones.has('+85293333333')).toBe(true)
  })
})

describe('buildPreviewWarnings — merge ON (AM-4 precedence)', () => {
  it('T-F1.4: a phone in alreadyMemberPhones only counts into willMerge', () => {
    const result = buildPreviewWarnings({
      rows: rows(['+85291111111']),
      lookups: lookups(['+85291111111'], []),
      merge: true,
    })
    expect(result.willMerge).toBe(1)
    expect(result.willSkipAlreadyMember).toBe(0)
    expect(result.willSkipActiveConsent).toBe(0)
  })

  it('a phone in activeConsentPhones only counts into willSkipActiveConsent', () => {
    const result = buildPreviewWarnings({
      rows: rows(['+85292222222']),
      lookups: lookups([], ['+85292222222']),
      merge: true,
    })
    expect(result.willSkipActiveConsent).toBe(1)
    expect(result.willMerge).toBe(0)
  })

  it('T-F1.6: a phone in BOTH sets counts as active-consent-skip, never merged', () => {
    const result = buildPreviewWarnings({
      rows: rows(['+85293333333']),
      lookups: lookups(['+85293333333'], ['+85293333333']),
      merge: true,
    })
    expect(result.willSkipActiveConsent).toBe(1)
    expect(result.willMerge).toBe(0)
    expect(result.willSkipAlreadyMember).toBe(0)
    expect(result.warnedPhones.has('+85293333333')).toBe(true)
  })
})

describe('buildPreviewWarnings — no match / aggregation / degraded lookups', () => {
  it('a phone in neither set contributes nothing', () => {
    const result = buildPreviewWarnings({
      rows: rows(['+85294444444']),
      lookups: lookups([], []),
      merge: false,
    })
    expect(result.willSkipAlreadyMember).toBe(0)
    expect(result.willMerge).toBe(0)
    expect(result.willSkipActiveConsent).toBe(0)
    expect(result.warnedPhones.size).toBe(0)
  })

  it('aggregates independently across multiple rows', () => {
    const result = buildPreviewWarnings({
      rows: rows(['+85291111111', '+85292222222', '+85295555555']),
      lookups: lookups(['+85291111111'], ['+85292222222']),
      merge: false,
    })
    expect(result.willSkipAlreadyMember).toBe(1)
    expect(result.willSkipActiveConsent).toBe(1)
    expect(result.warnedPhones.size).toBe(2)
    expect(result.warnedPhones.has('+85295555555')).toBe(false)
  })

  it('degraded lookups (empty sets from skipped/failed status) produce zero warnings', () => {
    const result = buildPreviewWarnings({
      rows: rows(['+85291111111']),
      lookups: { alreadyMemberPhones: [], activeConsentPhones: [], status: 'skipped_too_many_rows' },
      merge: false,
    })
    expect(result.willSkipAlreadyMember).toBe(0)
    expect(result.willMerge).toBe(0)
    expect(result.willSkipActiveConsent).toBe(0)
    expect(result.warnedPhones.size).toBe(0)
  })
})
