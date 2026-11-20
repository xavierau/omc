// INT-001 WI-3: frozen acceptance suite for `validateCreateMemberBody`
// (spec US-1, plan §"API Contracts"). T-M3: assert the raw value is never
// echoed back in a rejection.

import { describe, expect, it } from 'vitest'
import { validateCreateMemberBody } from '../integration-member-validators'

const VALID = {
  phone: '+85298765432',
  consent_level: 'all',
}

describe('validateCreateMemberBody (INT-001 WI-3, US-1)', () => {
  it('accepts a minimal valid body and normalises the phone to E.164', () => {
    const result = validateCreateMemberBody(VALID)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.value.phoneE164.value).toBe('+85298765432')
    expect(result.value.consentLevel).toBe('all')
    expect(result.value.sendWelcome).toBe(true)
    expect(result.value.name).toBeNull()
    expect(result.value.metadata).toBeNull()
  })

  it('non-object body -> not_object, never echoes the value', () => {
    const result = validateCreateMemberBody('not an object')
    expect(result).toEqual({ ok: false, fields: [{ field: 'body', code: 'not_object' }] })
  })

  it('missing phone -> required', () => {
    const result = validateCreateMemberBody({ consent_level: 'all' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fields).toContainEqual({ field: 'phone', code: 'required' })
  })

  it('phone that cannot be normalised to E.164 -> invalid_e164, value never echoed', () => {
    const result = validateCreateMemberBody({ ...VALID, phone: '9876x5432' })
    expect(result).toEqual({ ok: false, fields: [{ field: 'phone', code: 'invalid_e164' }] })
    expect(JSON.stringify(result)).not.toContain('9876x5432')
  })

  it('missing consent_level -> required', () => {
    const result = validateCreateMemberBody({ phone: VALID.phone })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fields).toContainEqual({ field: 'consent_level', code: 'required' })
  })

  it('consent_level not one of none|utility|all -> invalid_enum', () => {
    const result = validateCreateMemberBody({ ...VALID, consent_level: 'full' })
    expect(result).toEqual({ ok: false, fields: [{ field: 'consent_level', code: 'invalid_enum' }] })
  })

  it('name "Ada\\nLovelace\\t" normalises to "Ada Lovelace"', () => {
    const result = validateCreateMemberBody({ ...VALID, name: 'Ada\nLovelace\t' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.value.name).toBe('Ada Lovelace')
  })

  it('an 80-code-point emoji name is accepted', () => {
    const name = '\u{1F600}'.repeat(80)
    const result = validateCreateMemberBody({ ...VALID, name })
    expect(result.ok).toBe(true)
  })

  it('an 81-code-point emoji name is rejected as too_long, never truncated', () => {
    const name = '\u{1F600}'.repeat(81)
    const result = validateCreateMemberBody({ ...VALID, name })
    expect(result).toEqual({ ok: false, fields: [{ field: 'name', code: 'too_long' }] })
  })

  it('external_ref over 128 chars -> too_long', () => {
    const result = validateCreateMemberBody({ ...VALID, external_ref: 'x'.repeat(129) })
    expect(result).toEqual({ ok: false, fields: [{ field: 'external_ref', code: 'too_long' }] })
  })

  it('language not en|zh-HK -> invalid_enum', () => {
    const result = validateCreateMemberBody({ ...VALID, language: 'fr' })
    expect(result).toEqual({ ok: false, fields: [{ field: 'language', code: 'invalid_enum' }] })
  })

  it('language zh-HK maps to the stored zh_hk code', () => {
    const result = validateCreateMemberBody({ ...VALID, language: 'zh-HK' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.value.language).toBe('zh_hk')
  })

  it('send_welcome non-boolean -> invalid_type', () => {
    const result = validateCreateMemberBody({ ...VALID, send_welcome: 'yes' })
    expect(result).toEqual({ ok: false, fields: [{ field: 'send_welcome', code: 'invalid_type' }] })
  })

  it('metadata that is not an object -> not_object', () => {
    const result = validateCreateMemberBody({ ...VALID, metadata: ['a', 'b'] })
    expect(result).toEqual({ ok: false, fields: [{ field: 'metadata', code: 'not_object' }] })
  })

  it('~3KB metadata -> too_long (422)', () => {
    const result = validateCreateMemberBody({ ...VALID, metadata: { blob: 'x'.repeat(3000) } })
    expect(result).toEqual({ ok: false, fields: [{ field: 'metadata', code: 'too_long' }] })
  })

  it('metadata nested deeper than 3 -> too_deep', () => {
    const result = validateCreateMemberBody({ ...VALID, metadata: { a: { b: { c: { d: 1 } } } } })
    expect(result).toEqual({ ok: false, fields: [{ field: 'metadata', code: 'too_deep' }] })
  })

  it('metadata at exactly depth 3 is accepted', () => {
    const result = validateCreateMemberBody({ ...VALID, metadata: { a: { b: { c: 1 } } } })
    expect(result.ok).toBe(true)
  })

  it('XSS-shaped metadata is stored verbatim as JSONB, not escaped or rejected', () => {
    const payload = { note: '<script>alert(1)</script>' }
    const result = validateCreateMemberBody({ ...VALID, metadata: payload })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.value.metadata).toEqual(payload)
  })

  it('collects multiple field errors in one pass, none echoing values', () => {
    const result = validateCreateMemberBody({ phone: '9876x5432', consent_level: 'bogus' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.fields).toEqual(
      expect.arrayContaining([
        { field: 'phone', code: 'invalid_e164' },
        { field: 'consent_level', code: 'invalid_enum' },
      ])
    )
    expect(JSON.stringify(result)).not.toContain('bogus')
  })
})
