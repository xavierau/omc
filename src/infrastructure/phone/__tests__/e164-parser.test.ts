// INT-001 WI-1 frozen acceptance suite (T-C2).
// Source: threats/2026-09-10-int-001-member-creation-api.md §"Concrete
// acceptance tests" T-C2 -- the fixed format-variant list and the fixed
// rejection list are both taken verbatim from that artifact and must not be
// weakened.

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  DEFAULT_PHONE_REGION,
  parseE164Phone,
} from '../e164-parser'
import { isPhoneNormalizeError } from '@/domain/ports/phone-normalizer'

// Every one of these strings names the SAME Hong Kong subscriber number.
const ONE_NUMBER_FORMAT_VARIANTS = [
  '+852 9876 5432',
  '85298765432',
  '+852-9876-5432',
  '+852.9876.5432',
  '0085298765432',
  '9876 5432',
] as const

const EXPECTED_E164 = '+85298765432'

describe('parseE164Phone', () => {
  it('DEFAULT_PHONE_REGION is the named HK constant (OQ-7)', () => {
    expect(DEFAULT_PHONE_REGION).toBe('HK')
  })

  describe('property: every format variant of one HK number collapses to one E164Phone', () => {
    it.each(ONE_NUMBER_FORMAT_VARIANTS)('%s -> +85298765432', (raw) => {
      const result = parseE164Phone(raw, DEFAULT_PHONE_REGION)
      expect(isPhoneNormalizeError(result)).toBe(false)
      if (!isPhoneNormalizeError(result)) {
        expect(result.value).toBe(EXPECTED_E164)
      }
    })

    it('fast-check: any two format variants parse to the identical value', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ONE_NUMBER_FORMAT_VARIANTS),
          fc.constantFrom(...ONE_NUMBER_FORMAT_VARIANTS),
          (a, b) => {
            const ra = parseE164Phone(a, DEFAULT_PHONE_REGION)
            const rb = parseE164Phone(b, DEFAULT_PHONE_REGION)
            expect(isPhoneNormalizeError(ra)).toBe(false)
            expect(isPhoneNormalizeError(rb)).toBe(false)
            if (!isPhoneNormalizeError(ra) && !isPhoneNormalizeError(rb)) {
              expect(ra.value).toBe(rb.value)
            }
          }
        )
      )
    })
  })

  describe('rejection: never a throw, never echoes the raw input', () => {
    const REJECTED_INPUTS = [
      ['letters mixed with digits', '9876x5432'],
      ['zero-width space between digits', '+852​98765432'],
      ['16-digit number', '1234567890123456'],
      ['empty string', ''],
    ] as const

    it.each(REJECTED_INPUTS)('%s: %s -> invalid_e164', (_label, raw) => {
      expect(() => parseE164Phone(raw, DEFAULT_PHONE_REGION)).not.toThrow()
      const result = parseE164Phone(raw, DEFAULT_PHONE_REGION)
      expect(result).toEqual({ error: 'invalid_e164' })
      const visibleRaw = raw.replace(/[^\x20-\x7e]/g, '')
      if (visibleRaw.length > 0) {
        expect(JSON.stringify(result)).not.toContain(visibleRaw)
      }
    })

    it('fast-check: arbitrary strings never throw', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 64 }), (raw) => {
          expect(() => parseE164Phone(raw, DEFAULT_PHONE_REGION)).not.toThrow()
        })
      )
    })

    it('fast-check: any string containing a letter is always rejected', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[+\d\s().-]*[A-Za-z][+\d\s().-]*$/).filter((s) => s.length <= 32),
          (raw) => {
            const result = parseE164Phone(raw, DEFAULT_PHONE_REGION)
            expect(isPhoneNormalizeError(result)).toBe(true)
          }
        )
      )
    })

    it('whitespace-only input is rejected as empty', () => {
      const result = parseE164Phone('   ', DEFAULT_PHONE_REGION)
      expect(result).toEqual({ error: 'invalid_e164' })
    })

    it('a too-long digit run past 15 significant digits is rejected', () => {
      const result = parseE164Phone('+85298765432000000', DEFAULT_PHONE_REGION)
      expect(result).toEqual({ error: 'invalid_e164' })
    })
  })
})
